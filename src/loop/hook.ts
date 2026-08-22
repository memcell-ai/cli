import { dirname } from "node:path";

import { agentKeyForProject } from "../keyring.js";
import { findProject, type Project } from "../project.js";
import { LEGS, type Moment } from "./moments.js";
import { keepNote, dropNote, log, noteFor } from "./session.js";
import { adapterFor } from "../adapters/index.js";

// What an installed hook executes — the loop, fired by the harness rather
// than chosen by the model.
//
// THE RULE, above everything: this fails open, always. It runs inside
// somebody's coding session, between them pressing enter and their agent
// answering. If memcell is down, slow, unreachable or wrong, the right
// behaviour is to say nothing and let the session continue. A memory service
// that can break an agent is worse than no memory service, and it only has
// to happen once for the hooks to come out. Every path here exits 0.
//
// THE SECOND RULE: the hook ships and connects, it never judges. It hands
// the turn's material to `ingest` and the memory decides what was durable;
// it reports an outcome only where the memory itself said the material
// corroborated a statement. Deciding "was that worth keeping" or "did that
// help" on the client would be guessing with somebody's record.

/** Nobody is waiting at the end of a turn; somebody is watching the cursor
 *  at prompt-submit. The deadline follows who is waiting — and it RIDES THE
 *  REQUEST, so the instance composes its answer within it instead of being
 *  cut off by it: everything stored is served either way, and work that
 *  cannot fit (composing from a web search) is deferred to the instance's
 *  queue rather than attempted and abandoned. 8s covers a stored-only
 *  answer with margin from anywhere; what it no longer has to cover is
 *  open-ended work, because none runs under a watched deadline any more. */
const WATCHED_MS = 8_000;
const UNWATCHED_MS = 20_000;

interface Incoming {
  prompt?: string;
  transformedPrompt?: string;
  cwd?: string;
  session_id?: string;
  sessionId?: string;
  transcript_path?: string;
  transcriptPath?: string;
}

async function incoming(): Promise<Incoming> {
  if (process.stdin.isTTY) return {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text ? (JSON.parse(text) as Incoming) : {};
  } catch {
    return {};
  }
}

/**
 * Whether this directory can run the loop, and if not, which of the two
 * reasons it is: nothing wired here, or wired to a space this machine has no
 * key for. One line used to cover both and named the wrong one, sending
 * somebody to check the link file that was sitting right in front of them.
 */
type Standing =
  { ok: true; project: Project; key: string; agentId?: string } | { ok: false; why: string };

async function standing(cwd?: string): Promise<Standing> {
  const found = await findProject(cwd ?? process.cwd());
  if (!found) return { ok: false, why: "not wired · run memcell connect" };

  // Identity is the keyring's, found by the wired directory — the project
  // file names the memory, never the person.
  const held = await agentKeyForProject(found.project.instance, dirname(found.at));
  if (!held) {
    return { ok: false, why: `no key for ${found.project.space} · run memcell connect` };
  }
  // The wired agent, resolved HERE rather than read off the command line.
  // A hook carrying a baked-in id keeps reporting the agent it was wired
  // with long after a re-connect minted another one.
  return { ok: true, project: found.project, key: held.key, agentId: held.agentId };
}

/** What a loop door said. Fail-open is the AGENT's contract — a door that
 *  errors never blocks a turn — but the log is where an operator reads why
 *  nothing landed, and there "the instance refused" and "nothing durable"
 *  are different facts. Conflating them made a misconfigured instance read
 *  as an honest zero for a whole working day. */
type Answered<T> = { at: "answered"; body: T } | { at: "refused"; status: number } | null;

/** One call to a loop door. Null when the instance was never reached. */
async function door<T>(
  instance: string,
  key: string,
  path: string,
  body: unknown,
  deadlineMs: number,
  session?: string,
  agentId?: string,
  turn?: string,
): Promise<Answered<T>> {
  // One retry, on network failure only. A refusal is an answer — the
  // instance spoke — and retrying it would just ask twice. A hand-over
  // names its turn, so a delivery whose response was lost lands once: the
  // second arrival finds the first's moment.
  for (const attempt of [1, 2]) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), deadlineMs);
    try {
      const response = await fetch(`${instance}/api/v1/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          origin: instance,
          // What ties this call to the rest of the session. The hook is the
          // only thing that knows: a session BEGINS at the agent, and the
          // harness hands us its id at every firing. Without it every moment
          // stands alone on the record and "show me that session" can only be
          // answered by guessing from clocks.
          ...(session ? { "x-memcell-session": session } : {}),
          // Which wired agent fired this — the id from the hook config, carried
          // for attribution. The key already names the agent; this is explicit.
          ...(agentId ? { "x-memcell-agent": agentId } : {}),
          // How long this caller can wait — the instance works TO it.
          "x-memcell-budget": String(deadlineMs),
          // The turn's name, on hand-overs — one turn, one landing.
          ...(turn ? { "x-memcell-turn": turn } : {}),
        },
        body: JSON.stringify(body),
        signal: stop.signal,
      });
      if (!response.ok) return { at: "refused", status: response.status };
      return { at: "answered", body: (await response.json()) as T };
    } catch {
      if (attempt === 2) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The failure, in the log's words. */
function doorTrouble(answer: Answered<unknown>): string {
  return answer?.at === "refused"
    ? `the instance answered ${answer.status}`
    : "the instance could not be reached";
}

interface Recalled {
  statementId: string;
  text: string;
  confidence: number;
  layer: string;
  contested?: boolean;
}

/** Recalled statements, written for a model's turn: each carries what it is
 *  worth and where it sits, because a statement stripped of its confidence
 *  invites treating a 0.4 guess as a 0.9 fact. */
function asContext(results: Recalled[], space: string): string {
  return [
    `From this project's memory (${space}) — already learned here:`,
    ...results.map(
      (r) =>
        `- ${r.text}  [${r.confidence.toFixed(2)} · ${r.layer}${r.contested ? " · contested" : ""}]`,
    ),
    "",
    "These carry earned confidence, not certainty. If one proves wrong or out",
    "of date, say so rather than working around it.",
  ].join("\n");
}

export interface HookResult {
  context?: string;
  heard: { prompt?: string; transformedPrompt?: string };
}

export async function runMoment(moment: Moment, program: string): Promise<HookResult> {
  const payload = await incoming();
  const heard = { prompt: payload.prompt, transformedPrompt: payload.transformedPrompt };
  const here = await standing(payload.cwd);
  // Every log line opens with this: moment, program, and the agent id, so a
  // firing can be correlated to one wired agent when reading the log back.
  const agentId = here.ok ? here.agentId : undefined;
  const tag = agentId ? `${moment} ${program} ${agentId}` : `${moment} ${program}`;
  if (!here.ok) {
    await log(`${tag} · ${here.why}`);
    // Said once, at the start, and only when the loop cannot run AT ALL.
    //
    // The rule above is that this stays quiet, and that rule is about
    // FAILURE: an instance that is down or slow will be up again, and a hook
    // that complains about it is a hook people remove. Being unwired is not a
    // failure — it is permanent until somebody types one command, and the
    // only person who can is the one sitting there.
    //
    // Silence here is what let a whole session run believing it had memory:
    // the hooks fired four times, did nothing, and said so only in a log
    // nobody watches. An agent told nothing concludes memcell is broken; an
    // agent told this can say it out loud.
    return moment === "session-start" ? { heard, context: here.why } : { heard };
  }

  const { project, key } = here;
  // Two different things that happen to look alike. The first names the
  // note file on this machine and may fall back to a placeholder; the second
  // is an IDENTITY that goes on somebody's record, so a harness that told us
  // nothing has to produce no session rather than a shared fiction — every
  // unidentified firing would otherwise read back as one long session.
  const session = payload.session_id ?? payload.sessionId;
  const sessionId = session ?? "unknown";
  const note = await noteFor(sessionId);
  note.space = project.space;
  const legs = LEGS[moment];
  const result: HookResult = { heard };

  // ── recall ────────────────────────────────────────────────────────────
  if (legs.includes("recall")) {
    // Prompt-submit asks the prompt. Session start has no prompt yet, so it
    // asks about the work itself — what anyone opening this project should
    // be carrying before they type anything.
    const intent =
      moment === "prompt-submit"
        ? (payload.prompt ?? payload.transformedPrompt ?? "").trim()
        : `starting work in ${project.space}: the standing decisions, conventions and gotchas here`;

    if (intent) {
      const asked = await door<{ momentId: string; results: Recalled[]; note?: string }>(
        project.instance,
        key,
        "recall",
        { intent },
        moment === "prompt-submit" ? WATCHED_MS : UNWATCHED_MS,
        session,
        agentId,
      );
      const answer = asked?.at === "answered" ? asked.body : null;
      if (!answer) {
        // The turn goes on without memory — fail open — but the log says
        // what actually happened, not "0 served".
        await log(`${tag} · recall · ${doorTrouble(asked)}`);
      }
      const results = answer?.results ?? [];
      if (results.length > 0) {
        result.context = asContext(results, project.space);
        // No served-set is tracked here any more: recall already writes the
        // moment with this session's id, and the engine reads what the session
        // recalled from there when it assigns credit. The hook does not carry
        // the correlation it no longer performs.
      } else if (moment === "session-start" && answer?.note) {
        // Nothing was found, and the memory said why. Passing that on once,
        // at the start, is the difference between an agent concluding memcell
        // is broken and an agent knowing there is a memory here to fill.
        // Not at prompt-submit: somebody is watching the cursor there, and
        // the same sentence on every prompt is noise, not help.
        result.context = answer.note;
      }
      if (answer) {
        await log(
          `${tag} · recall · ${results.length} served${answer.note ? ` · ${answer.note}` : ""}`,
        );
      }
    } else {
      await log(`${tag} · recall · nothing to ask`);
    }
  }

  // ── remember, and the report the memory's own answer justifies ─────────
  if (legs.includes("remember")) {
    // Read in the agent's own dialect — the adapter that speaks for this
    // program also reads its record; an agent this build does not know
    // reads as empty. Claude and Gemini hand a transcript path; Codex and
    // Copilot are located from the session id and cwd.
    // The turn's name, fixed BEFORE the read moves the offset: the session
    // plus where in the transcript this delta starts identifies the
    // delivery, and stays identical across a retry of it.
    const turn = session ? `${session}:${JSON.stringify(note.read ?? 0)}` : undefined;
    const material = (await adapterFor(program)?.read(payload, note.read)) ?? {
      text: "",
      touched: [],
      read: note.read,
    };
    const advanced = material.read !== note.read;
    note.read = material.read;

    // Material without an advance is never handed over. The turn's name is
    // the session plus this offset, so an offset that stands still names the
    // next turn identically to this one — and the instance, doing exactly
    // what it should with a name it has already seen, stands the delivery
    // down as already handed over. The session then never captures again.
    // A reader is not trusted to keep that invariant on its own; it is
    // checked here, where the name is made.
    if (material.text.length >= 20 && !advanced) {
      await log(`${tag} · remember · read returned material without advancing — held back`);
    } else if (material.text.length >= 20) {
      const handed = await door<{
        created: { statementId: string }[];
        reinforced: { statementId: string }[];
        attributed: { statementId: string; outcome: "worked" | "failed" }[];
        superseded?: { statementId: string; byStatementId: string }[];
        note?: string;
      }>(
        project.instance,
        key,
        `spaces/${encodeURIComponent(project.space)}/ingest`,
        {
          raw: material.text,
          origin: { title: `${program} session` },
          // The names of the files this turn wrote — names only, never
          // contents — so the session can be read back as work, not just
          // as prose. Absent when the transcript named none.
          ...(material.touched.length > 0 ? { touched: material.touched } : {}),
        },
        UNWATCHED_MS,
        session,
        agentId,
        turn,
      );
      const kept = handed?.at === "answered" ? handed.body : null;
      if (kept) {
        const created = kept.created.length;
        const reinforced = kept.reinforced;
        const superseded = kept.superseded?.length ?? 0;
        // The log carries the memory's own words for what it did, so reading
        // ~/.memcell/hook.log answers "why nothing" without guessing.
        await log(
          `${tag} · remember · ${created} kept, ${reinforced.length} reinforced${superseded > 0 ? `, ${superseded} superseded` : ""}${kept.note ? ` · ${kept.note}` : ""}`,
        );
      } else {
        // The delivery got no answer. What that MEANS depends on how far it
        // got: an instance that answered an error refused before doing the
        // work, and the turn is not captured; a delivery that timed out or
        // lost its response may well have landed — the instance arms a
        // safety net before distilling, and the turn is named, so the next
        // delivery of it is a no-op either way. Say which case this is.
        await log(
          handed?.at === "refused"
            ? `${tag} · remember · ${doorTrouble(handed)} — this turn was not captured`
            : `${tag} · remember · ${doorTrouble(handed)} — the instance may still land it`,
        );
      }

      // ── report ───────────────────────────────────────────────────────
      // Not judged here — the engine judged. The one ingest above shipped the
      // turn's material AND the session it belongs to; the engine read what
      // that session recalled and assigned credit, worked or failed. THE HOOK
      // IS A PIPE: it only reports what came back. This is why the correlation
      // that used to live here — match a reinforced statement to a recall and
      // call it worked — is gone: it was a judgment, and it never once said
      // failed.
      if (legs.includes("report")) {
        if (kept) {
          const attributed = kept.attributed ?? [];
          if (attributed.length > 0) {
            const worked = attributed.filter((a) => a.outcome === "worked").length;
            const failed = attributed.length - worked;
            await log(`${tag} · report · ${worked} worked${failed ? `, ${failed} failed` : ""}`);
          } else {
            await log(`${tag} · report · nothing the session bore on`);
          }
        } else {
          await log(`${tag} · report · not asked — the hand-over did not land`);
        }
      }
    } else {
      await log(`${tag} · remember · nothing new to hand over`);
    }
  }

  if (moment === "session-end") await dropNote(sessionId);
  else await keepNote(sessionId, note);

  return result;
}
