import { actOf } from "./act.js";
import { can } from "../adapters/surface.js";
import { dirname } from "node:path";
import { evaluatePreAct, stageRulesFromRecall, type RawStatementInput } from "./pre-act.js";

import { agentKeyForProject } from "../keyring.js";
import { findProject, type Project } from "../project.js";
import { PIPELINE_PHASES, LEGS, type LifecycleHook, type Moment } from "./moments.js";
import {
  keepSessionCache,
  dropSessionCache,
  log,
  sessionCacheFor,
  type SessionCache,
  type Note,
} from "./session.js";
import { adapterFor } from "../adapters/index.js";
import {
  readIntentEnvelope,
  readLatestUserPrompt,
  type TranscriptDelta,
} from "../adapters/capture.js";
import { detectActiveRuntimeModel } from "../model-detect.js";

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
// the turn's transcript delta to `ingest` and the memory engine distills what was durable;
// it reports an outcome only where the memory itself said the turn
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
/** The turn payload delivery budget. The instance takes a named turn and QUEUES
 *  it, so what this covers is shipping the transcript delta and getting the claim
 *  written — not the reading, which is several model passes and was never
 *  something a hook could wait out. Roomier than the rest because a turn's
 *  payload can be large and the link can be slow; nothing here waits on a
 *  model. */
const PAYLOAD_TIMEOUT_MS = 60_000;
const HANDOVER_MS = PAYLOAD_TIMEOUT_MS; // Backwards-compatible alias
/** How many rule-and-act pairings one turn hands over. A turn with forty
 *  acts must not cost forty judgements, and the same rule against the same
 *  kind of act twice says nothing the first one did not. */
const SERVED_AT_LIMIT = 12;

interface Incoming {
  prompt?: string;
  transformedPrompt?: string;
  cwd?: string;
  session_id?: string;
  sessionId?: string;
  transcript_path?: string;
  transcriptPath?: string;
  /** The act about to happen, at `before-act`. Every harness names these two
   *  things; only the spelling differs, so both are read. */
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
  /** Protojson tool call structure sent by Antigravity and Vertex AI agents */
  toolCall?: { name?: string; args?: Record<string, unknown> };
  model?: string;
  subagent_type?: string;
  subagentType?: string;
  agent_type?: string;
  agentType?: string;
  agent_id?: string;
  agentId?: string;
  agent_transcript_path?: string;
  agentTranscriptPath?: string;
  last_assistant_message?: string;
  lastAssistantMessage?: string;
  task?: string;
  workspace_roots?: string[];
  workspaceRoots?: string[];
  hook_event_name?: string;
  hookEventName?: string;
  error?: string;
  error_message?: string;
  errorMessage?: string;
  failure_type?: string;
  failureType?: string;
  result?: unknown;
}

async function incoming(): Promise<Incoming> {
  if (process.stdin.isTTY) return {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};
    const raw = JSON.parse(text) as Incoming & {
      conversationId?: string;
      conversation_id?: string;
      workspacePaths?: string[];
      workspace_roots?: string[];
      workspaceRoots?: string[];
      model?: string;
      subagent_type?: string;
      subagentType?: string;
      agent_type?: string;
      agentType?: string;
      agent_id?: string;
      agentId?: string;
      task?: string;
      hook_event_name?: string;
      hookEventName?: string;
    };
    raw.sessionId ??= raw.conversationId;
    raw.session_id ??= raw.conversation_id;
    const roots = raw.workspacePaths ?? raw.workspace_roots ?? raw.workspaceRoots;
    if (roots && roots.length > 0 && !raw.cwd) {
      raw.cwd = roots[0];
    }
    const subagent = raw.subagent_type ?? raw.subagentType ?? raw.agent_type ?? raw.agentType;
    if (subagent) {
      raw.tool_name ??= "subagent";
      raw.tool_input ??= {
        subagent,
        prompt: raw.prompt ?? raw.task ?? raw.last_assistant_message,
        task: raw.task ?? raw.last_assistant_message,
      };
    }
    if (raw.toolCall) {
      raw.tool_name ??= raw.toolCall.name;
      raw.tool_input ??= raw.toolCall.args;
    }
    return raw;
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
export type ProjectWiring =
  { ok: true; project: Project; key: string; agentId?: string } | { ok: false; why: string };
export type Standing = ProjectWiring; // Backwards-compatible alias

export async function resolveProjectWiring(cwd?: string, program?: string): Promise<ProjectWiring> {
  const found = await findProject(cwd ?? process.cwd());
  if (!found) return { ok: false, why: "not wired · run memcell connect" };

  // Identity is the keyring's, found by the wired directory and program —
  // the project file names the memory, never the person.
  const held = await agentKeyForProject(found.project.instance, dirname(found.at), program);
  if (!held) {
    return { ok: false, why: `no key for ${found.project.space} · run memcell connect` };
  }
  // The wired agent, resolved HERE rather than read off the command line.
  // A hook carrying a baked-in id keeps reporting the agent it was wired
  // with long after a re-connect minted another one.
  return { ok: true, project: found.project, key: held.key, agentId: held.agentId };
}
export const standing = resolveProjectWiring; // Backwards-compatible alias

/** What a loop API endpoint returned. Fail-open is the AGENT's contract — an endpoint that
 *  errors never blocks a turn — but the log is where an operator reads why
 *  nothing landed, and there "the instance refused" and "nothing durable"
 *  are different facts. Conflating them made a misconfigured instance read
 *  as an honest zero for a whole working day. */
type Answered<T> =
  | { at: "answered"; status: number; body: T }
  /** `said` is the API's own sentence about the refusal, when it sent one.
   *  A 4xx is the caller's fault and the instance always says what is wrong;
   *  this used to be dropped here, so nine days of a capture leg refusing
   *  the same turn logged a bare status and nothing else. */
  | { at: "refused"; status: number; said?: string }
  | null;

/** One call to a loop API endpoint. Null when the instance was never reached. */
export async function apiCall<T>(
  instance: string,
  key: string,
  path: string,
  body: unknown,
  deadlineMs: number,
  session?: string,
  agentId?: string,
  turn?: string,
  model?: string,
): Promise<Answered<T>> {
  // One retry, on network failure only. A refusal is an answer — the
  // instance spoke — and retrying it would just ask twice. A delivery
  // names its turn, so a delivery whose response was lost lands once: the
  // second arrival finds the first's moment.
  //
  // The deadline is the TOTAL budget, not a per-attempt one. It used to be
  // per attempt, so an unreachable instance froze the cursor for twice the
  // number the caller chose — 16 seconds at prompt-submit, on every prompt,
  // for a person who has no idea memcell is why their agent has stopped.
  // What was promised is what is spent.
  const startedAt = Date.now();
  for (const attempt of [1, 2]) {
    const left = deadlineMs - (Date.now() - startedAt);
    if (left <= 0) return null;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), left);
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
          // The turn's name, on deliveries — one turn, one landing.
          ...(turn ? { "x-memcell-turn": turn } : {}),
          // Active runtime model if detected
          ...(model ? { "x-memcell-model": model } : {}),
        },
        body: JSON.stringify(body),
        signal: stop.signal,
      });
      if (!response.ok) {
        // Read once, defensively: a refusal that is not JSON must not turn a
        // refusal into an unreachable instance, which is a different fault
        // with a different fix.
        const said = await response
          .json()
          .then((b) => (b as { message?: unknown }).message)
          .catch(() => undefined);
        return {
          at: "refused",
          status: response.status,
          ...(typeof said === "string" && said.trim() ? { said: said.trim() } : {}),
        };
      }
      return { at: "answered", status: response.status, body: (await response.json()) as T };
    } catch {
      if (attempt === 2) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
export const door = apiCall; // Backwards-compatible alias

/**
 * The most one turn payload may carry, mirroring the backend endpoint's own ceiling.
 *
 * Declared here rather than discovered: the endpoint refuses a larger delivery
 * with a 400, and a client that only learns its limit by being refused
 * spends a turn's work to find it out. Kept a little under the endpoint's
 * 600k so a delivery is never refused for a rounding difference.
 *
 * The TAIL is what ships. A turn long enough to hit this is one where the
 * end is the conclusion and the start is the search that got there.
 */
export const MAX_PAYLOAD_CHARS = 560_000;
export const MAX_HANDOVER_CHARS = MAX_PAYLOAD_CHARS; // Backwards-compatible alias

/** Will the same bytes earn the same refusal? Then holding them is not a
 *  retry, it is a loop: the next read starts where this one did, reaches a
 *  larger end, and is refused again. Only a refusal the CONTENT caused
 *  behaves that way — an outage, a spent budget or a revoked key are all
 *  worth waiting on. */
const refusedForGood = (status: number): boolean =>
  status === 400 || status === 413 || status === 422;

export function formatApiError(answer: Answered<unknown>): string {
  if (answer?.at !== "refused") return "the instance could not be reached";
  // The REASON, not just the number.
  //
  // A 4xx is the caller's fault and the API says exactly what is wrong in
  // the body — and this threw that away. So a capture leg refusing the same
  // turn every firing for nine days logged "the instance answered 400" 204
  // times and nobody could tell from the log what to fix.
  return answer.said
    ? `the instance answered ${answer.status} — ${answer.said}`
    : `the instance answered ${answer.status}`;
}
export const doorTrouble = formatApiError; // Backwards-compatible alias

export interface Recalled {
  statementId: string;
  text: string;
  confidence: number;
  layer: string;
  kind?: string;
  /** The moments this bears on — read, change, record, send, answer. Empty
   *  for knowledge, which is most of a memory. */
  appliesAt?: string[];
  contested?: boolean;
  /** Served because this session already went against it. */
  diverged?: boolean;
  violated?: boolean;
  /** Somebody asked this rule to STOP the act it bears on. */
  refuses?: boolean;
  pinned?: boolean;
  standing?: boolean;
  vouched?: boolean;
  verified?: boolean;
}

/** A statement is treated as an operational guard if the memory flagged it as
 *  refusing the act, if its kind is an explicit trap/dead-end/gotcha, if it is
 *  a standing invariant or action rule, or if its text specifies a hard
 *  prohibition or mandatory trigger constraint. */
export function isGuard(r: Recalled): boolean {
  if (r.refuses || r.kind === "dead_end" || r.kind === "gotcha") return true;
  if (r.standing || r.pinned || (r.appliesAt && r.appliesAt.length > 0)) return true;
  return /\b(prohibited|forbidden|must not|never|do not|cannot|only when (?:explicitly )?triggered by)\b/i.test(
    r.text,
  );
}

interface TriggerViolation {
  rule: Recalled;
  trigger: string;
}

function findTriggerViolations(guards: Recalled[], prompt: string): TriggerViolation[] {
  const violations: TriggerViolation[] = [];
  const triggerPattern =
    /(?:only when (?:explicitly )?triggered by|requires (?:explicit )?)\s+(\[[\w-]+\])/i;

  for (const rule of guards) {
    const match = rule.text.match(triggerPattern);
    if (!match || !match[1]) continue;
    const trigger = match[1];
    const keyword = trigger.slice(1, -1).toLowerCase();

    const promptLower = prompt.toLowerCase();
    const keywordRegex = new RegExp(`\\b${keyword.replace(/-/g, "[ -]?")}\\b`, "i");
    if (keywordRegex.test(promptLower) && !prompt.includes(trigger)) {
      violations.push({ rule, trigger });
    }
  }

  return violations;
}

/** Recalled statements, written for a model's turn: each carries what it is
 *  worth and where it sits, because a statement stripped of its confidence
 *  invites treating a 0.4 guess as a 0.9 fact.
 *
 *  Guards and preconditions are separated from empirical conventions so an agent
 *  cannot rationalize around a hard gate as if it were a soft suggestion. */
export function asContext(results: Recalled[], space: string, prompt?: string): string {
  // What this session has already gone against leads, and says so. Buried in
  // a list of fifteen it reads as one more fact; the session has already
  // demonstrated that is not enough.
  const against = results.filter((r) => r.diverged);
  const rest = results.filter((r) => !r.diverged);
  const guards = rest.filter(isGuard);
  const conventions = rest.filter((r) => !isGuard(r));

  const sections: string[] = [];

  // If a prompt requests an action governed by an explicit syntactic trigger
  // but omits the trigger token, warn loudly at the very top of context.
  if (prompt && guards.length > 0) {
    const triggerViolations = findTriggerViolations(guards, prompt);
    for (const v of triggerViolations) {
      sections.push(
        [
          `🚨 OPERATIONAL GUARD TRIGGER REQUIRED:`,
          `Rule [${v.rule.statementId.slice(0, 8)}] requires the explicit trigger '${v.trigger}' to execute this flow:`,
          `"${v.rule.text}"`,
          `The current prompt does NOT contain '${v.trigger}'.`,
          `You MUST HALT and refuse to proceed with this operation until the user explicitly provides the '${v.trigger}' trigger token.`,
          "",
        ].join("\n"),
      );
    }
  }

  if (against.length > 0) {
    sections.push(
      [
        "You have already gone against these this session — re-read them before continuing:",
        ...against.map(
          (r) =>
            `- ${r.text}  [id: ${r.statementId.slice(0, 8)} · ${r.confidence.toFixed(2)} · ${r.layer}]`,
        ),
        "",
        "If you believe one no longer applies, say so plainly rather than",
        "working around it again (or report with 'memcell report <id> failed').",
        "",
      ].join("\n"),
    );
  }

  if (guards.length > 0) {
    sections.push(
      [
        "OPERATIONAL GUARDS & INVARIANTS (Enforce strictly — halt or refuse if required triggers/conditions are missing):",
        ...guards.map(
          (r) =>
            `- [GUARD] ${r.text}  [id: ${r.statementId.slice(0, 8)} · ${r.confidence.toFixed(2)} · ${r.layer}${r.contested ? " · contested" : ""}]`,
        ),
        "",
        "Do NOT bypass, rationalize around, or treat these guards as optional.",
        "If a required trigger syntax or precondition is absent, you must stop and request it.",
        "",
      ].join("\n"),
    );
  }

  if (conventions.length > 0) {
    sections.push(
      [
        `From this project's memory (${space}) — already learned here:`,
        ...conventions.map(
          (r) =>
            `- ${r.text}  [id: ${r.statementId.slice(0, 8)} · ${r.confidence.toFixed(2)} · ${r.layer}${r.contested ? " · contested" : ""}]`,
        ),
        "",
        "These carry earned confidence, not certainty. If one proves wrong or out",
        "of date, say so rather than working around it.",
      ].join("\n"),
    );
  }

  return sections.join("\n");
}

export interface HookResult {
  context?: string;
  /** A directive somebody asked to stop this act, in its own words. The command
   *  turns it into whatever refusal this harness understands — the reason is
   *  always the directive itself, so nobody is stopped without being told why. */
  refuse?: string;
  heard: { prompt?: string; transformedPrompt?: string; hookEventName?: string };
}

export async function runMoment(moment: LifecycleHook, program: string): Promise<HookResult> {
  const payload = await incoming();
  const transcriptPath = payload.transcript_path ?? payload.transcriptPath;
  if (
    moment === "prompt-submit" &&
    !payload.prompt &&
    !payload.transformedPrompt &&
    transcriptPath
  ) {
    const latest = await readLatestUserPrompt(transcriptPath);
    if (latest) {
      payload.prompt = latest;
    }
  }
  const hookEventName = payload.hook_event_name ?? payload.hookEventName;
  const heard = {
    prompt: payload.prompt,
    transformedPrompt: payload.transformedPrompt,
    hookEventName,
  };
  const here = await resolveProjectWiring(payload.cwd, program);

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
  // session cache file on this machine and may fall back to a placeholder; the second
  // is an IDENTITY that goes on somebody's record, so a harness that told us
  // nothing has to produce no session rather than a shared fiction — every
  // unidentified firing would otherwise read back as one long session.
  const session = payload.session_id ?? payload.sessionId;
  const sessionId = session ?? "unknown";
  const note = await sessionCacheFor(sessionId);
  note.space = project.space;

  const runtimeModel =
    detectActiveRuntimeModel(program) ||
    (typeof payload.model === "string" && payload.model.trim()
      ? payload.model.trim()
      : undefined) ||
    note.model;
  if (runtimeModel) note.model = runtimeModel;

  const phases = PIPELINE_PHASES[moment];
  const result: HookResult = { heard };

  // Every path out of `before-act` returns from here, and the session cache is kept at
  // the BOTTOM of this function — so all six of those returns skipped it.
  //
  // The hook wrote `note.servedAt` in memory and the process exited without
  // saving it, on every act, in every session, since the pairing was
  // introduced. Which rule was put in front of which act is the one fact
  // only this hook sees; the instance cannot infer it from the transcript,
  // and that is the whole reason it is recorded here. Lost on exit, no
  // `rule_act` row was ever written: a memory whose rules fired every turn
  // read as one whose rules had never fired at all.
  //
  // The cache is now kept on the way out. `keepSessionCache` is best-effort and
  // never throws — a hook that dies takes the user's turn with it.
  const leaving = async (r: HookResult): Promise<HookResult> => {
    await keepSessionCache(sessionId, note);
    return r;
  };

  // ── before an act ─────────────────────────────────────────────────────
  //
  // A rule read at the top of a session and needed forty steps later is a
  // rule nobody is holding by the time it applies. This says the one that
  // bears on THIS act, at the moment of it.
  //
  // It costs no call: the rules came down with the turn's recall and the
  // choosing happens here. It says nothing far more often than it says
  // something — an act nothing bears on, or an act this build cannot name,
  // is silence. A rule shown where it does not apply is worse than none,
  // because the next one is skipped too.
  if (moment === "before-act") {
    const tool = payload.tool_name ?? payload.toolName ?? "";
    const guard = adapterFor(program)?.surface?.guard;
    if (!tool || !guard || !can(guard)) return leaving(result);

    const evalResult = evaluatePreAct({
      tool,
      input: (payload.tool_input ?? payload.toolInput) as Record<string, unknown> | undefined,
      guard,
      activeRules: note.activeRules ?? note.standing ?? [],
      firedMap: note.fired,
    });

    if (evalResult.verdict === "pass") {
      return leaving(result);
    }

    const pairs = note.servedAt ?? (note.servedAt = []);
    for (const p of evalResult.pairs) {
      if (pairs.length >= SERVED_AT_LIMIT) break;
      if (pairs.some((x) => x.statementId === p.statementId && x.act === p.act)) continue;
      pairs.push(p);
    }

    if (evalResult.verdict === "refuse") {
      result.refuse = evalResult.reason;
      await log(`${tag} · before-act · ${tool} is ${evalResult.act} · refused · ${result.refuse}`);
      return leaving(result);
    }

    if (evalResult.verdict === "advise") {
      const saidKey = `said:${evalResult.act}`;
      note.fired[saidKey] = Date.now();
      result.context = evalResult.guidance;
      note.pendingGuidance = evalResult.guidance;
      await log(
        `${tag} · before-act · ${tool} is ${evalResult.act} · ${evalResult.bears.length} said`,
      );
      return leaving(result);
    }

    return leaving(result);
  }

  if (moment === "after-act") {
    if (note.pendingGuidance) {
      result.context = note.pendingGuidance;
      note.pendingGuidance = null;
      await log(`${tag} · after-act · delivered staged guidance`);
      return leaving(result);
    }

    const errorMessage =
      payload.error_message ?? (payload as { errorMessage?: string }).errorMessage ?? payload.error;
    const failureType = payload.failure_type ?? (payload as { failureType?: string }).failureType;
    if (errorMessage || failureType) {
      const tool = payload.tool_name ?? payload.toolName ?? "";
      const reason = errorMessage || failureType || "unknown error";
      await log(`${tag} · after-act · tool failure on ${tool || "action"}: ${reason}`);
      result.context = `Tool execution failed on ${tool || "action"}: ${reason}. Review active directives before retrying.`;
      return leaving(result);
    }

    return leaving(result);
  }

  // ── recall ────────────────────────────────────────────────────────────
  if (phases.includes("recall")) {
    // Prompt-submit asks the prompt. Session start has no prompt yet, so it
    // asks about the work itself — what anyone opening this project should
    // be carrying before they type anything.
    const rawPrompt =
      moment === "prompt-submit" ? (payload.prompt ?? payload.transformedPrompt ?? "").trim() : "";
    const intent =
      moment === "prompt-submit"
        ? await readIntentEnvelope(transcriptPath, rawPrompt)
        : `starting work in ${project.space}: the standing decisions, conventions and gotchas here`;

    if (intent) {
      const asked = await apiCall<{
        momentId?: string;
        recallId?: string;
        results?: Recalled[];
        statements?: RawStatementInput[];
        guardMode?: "strict" | "advisory";
        profile?: string | null;
        note?: string;
      }>(
        project.instance,
        key,
        "recall",
        { intent },
        moment === "prompt-submit" ? WATCHED_MS : UNWATCHED_MS,
        session,
        agentId,
        undefined,
        runtimeModel,
      );
      const answer = asked?.at === "answered" ? asked.body : null;
      if (!answer) {
        // The turn goes on without memory — fail open — but the log says
        // what actually happened, not "0 served".
        await log(`${tag} · recall · ${formatApiError(asked)}`);
      }
      const rawStatements = (answer?.statements ?? answer?.results ?? []) as RawStatementInput[];
      const guardMode = (answer?.guardMode ?? note.guardMode ?? "strict") as "strict" | "advisory";
      note.guardMode = guardMode;

      const staged = stageRulesFromRecall(rawStatements, guardMode);
      if (staged.length > 0) {
        note.activeRules = staged;
        note.standing = staged;
      }

      const results: Recalled[] = rawStatements.map((r) => {
        const statementId = (r.id ?? r.statementId ?? "") as string;
        const text = r.title ? (r.context ? `${r.title}: ${r.context}` : r.title) : (r.text ?? "");
        return {
          statementId,
          text,
          confidence: r.confidence ?? 0.8,
          layer: r.layer ?? (r.tags?.join(", ") || "project"),
          kind:
            r.kind ??
            (r.tags?.includes("guard")
              ? "guard"
              : r.tags?.includes("convention")
                ? "convention"
                : undefined),
          tags: r.tags,
          appliesAt: r.appliesAt,
          refuses: guardMode === "strict" ? r.tags?.includes("guard") || r.refuses : false,
          contested: Boolean(r.contested),
          diverged: Boolean(r.diverged || r.violated),
          violated: Boolean(r.diverged || r.violated),
          vouched: Boolean(r.vouched || r.verified),
          verified: Boolean(r.vouched || r.verified),
        };
      });

      if (results.length > 0) {
        result.context = asContext(results, project.space, heard.prompt ?? heard.transformedPrompt);
      } else if (moment === "session-start" && answer?.note) {
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
  if (phases.includes("remember")) {
    // Read in the agent's own dialect — the adapter that speaks for this
    // program also reads its record; an agent this build does not know
    // reads as empty. Claude and Gemini hand a transcript path; Codex and
    // Copilot are located from the session id and cwd.
    // The turn's name, fixed BEFORE the read moves the offset: the session
    // plus where in the transcript this delta starts identifies the
    // delivery, and stays identical across a retry of it.
    const turn = session ? `${session}:${JSON.stringify(note.read ?? 0)}` : undefined;
    const transcriptDelta: TranscriptDelta = (await adapterFor(program)?.read(
      payload,
      note.read,
    )) ?? {
      text: "",
      touched: [],
      read: note.read,
    };
    const advanced = transcriptDelta.read !== note.read;
    // Where this turn started, kept so a delivery that did NOT land can be
    // read again. Advancing past transcript delta the instance never took is how a
    // turn's work disappears silently, which is the same shape as the offset
    // bug that wedged capture for two days — the other direction.
    const startedAt = note.read;
    note.read = transcriptDelta.read;

    // Transcript delta without an advance is never delivered. The turn's name is
    // the session plus this offset, so an offset that stands still names the
    // next turn identically to this one — and the instance, doing exactly
    // what it should with a name it has already seen, stands the delivery
    // down as already handed over. The session then never captures again.
    // A reader is not trusted to keep that invariant on its own; it is
    // checked here, where the name is made.
    // TRIMMED, because that is what the endpoint measures.
    //
    // This read the raw length and the instance reads `raw.trim().length`,
    // so a turn whose delta is mostly whitespace passed here and was refused
    // there — and a refused turn is HELD and retried, so the same transcript delta
    // came back every firing and nothing behind it could land either. 204
    // refusals across nine days, all of them this.
    const enough = transcriptDelta.text.trim().length >= 20;

    if (enough && !advanced) {
      await log(`${tag} · remember · read returned transcript delta without advancing — held back`);
    } else if (enough) {
      const handed = await apiCall<{
        created: { statementId: string }[];
        reinforced: { statementId: string }[];
        attributed: { statementId: string; outcome: "worked" | "failed" }[];
        diverged?: { statementId: string; text: string }[];
        superseded?: { statementId: string; byStatementId: string }[];
        note?: string;
      }>(
        project.instance,
        key,
        "ingest",
        {
          raw:
            transcriptDelta.text.length > MAX_PAYLOAD_CHARS
              ? transcriptDelta.text.slice(-MAX_PAYLOAD_CHARS)
              : transcriptDelta.text,
          origin: { title: `${program} session` },
          // What was put in front of what, and before which act. The record
          // knows the pairing already; this is the half only the client saw.
          ...((note.servedAt ?? []).length > 0 ? { served_at: note.servedAt } : {}),
          // The names of the files this turn wrote — names only, never
          // contents — so the session can be read back as work, not just
          // as prose. Absent when the transcript named none.
          ...(transcriptDelta.touched.length > 0 ? { touched: transcriptDelta.touched } : {}),
        },
        PAYLOAD_TIMEOUT_MS,
        session,
        agentId,
        turn,
        runtimeModel,
      );
      const kept = handed?.at === "answered" ? handed.body : null;
      // Judged once. Cleared only on a delivery that landed — a held turn
      // carries them to the redelivery, the same way it carries its offset.
      if (kept) note.servedAt = [];
      // 202 means the instance TOOK the turn, durably, and has not read it
      // yet. Counting that as "0 kept" would put a lie in the log on every
      // ordinary turn, so it is said as what it is.
      const queued = handed?.at === "answered" && handed.status === 202;
      if (kept && queued) {
        await log(`${tag} · remember · handed over${kept.note ? ` · ${kept.note}` : ""}`);
      } else if (kept) {
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
        // Nothing landed, so the offset goes back: the next firing re-reads
        // this transcript delta rather than skipping it. Safe to re-deliver, because
        // the turn's name is derived from this very offset — an instance
        // that DID land it sees the same name and stands the repeat down.
        // Held for a retry — unless retrying is what wedges it. A refusal
        // the content earned will be earned again by the same content, and
        // the offset going back means the next read is BIGGER: the delivery
        // that was too large becomes larger still, forever. That ran for two
        // days on a real machine before anyone could see it, because the log
        // said "holding for the next firing" every single time.
        const forGood = handed?.at === "refused" && refusedForGood(handed.status);
        if (!forGood) note.read = startedAt;
        await log(
          forGood
            ? `${tag} · remember · ${formatApiError(handed as Answered<unknown>)} — this turn was refused and is not worth re-sending; moving past it`
            : handed?.at === "refused"
              ? `${tag} · remember · ${formatApiError(handed)} — not captured, holding this turn for the next firing`
              : `${tag} · remember · ${formatApiError(handed)} — no answer, holding this turn for the next firing`,
        );
      }

      // ── report ───────────────────────────────────────────────────────
      // Not judged here — the engine judged. The one ingest above shipped the
      // turn's transcript delta AND the session it belongs to; the engine read what
      // that session recalled and assigned credit, worked or failed. THE HOOK
      // IS A PIPE: it only reports what came back. This is why the correlation
      // that used to live here — match a reinforced statement to a recall and
      // call it worked — is gone: it was a judgment, and it never once said
      // failed.
      if (phases.includes("report")) {
        if (queued) {
          // The judge runs where the reading runs. Nothing to say yet, and
          // "nothing the session bore on" would be a verdict nobody reached.
        } else if (kept) {
          const attributed = kept.attributed ?? [];
          if (attributed.length > 0) {
            const worked = attributed.filter((a) => a.outcome === "worked").length;
            const failed = attributed.length - worked;
            await log(`${tag} · report · ${worked} worked${failed ? `, ${failed} failed` : ""}`);
          } else {
            await log(`${tag} · report · nothing the session bore on`);
          }
          // Divergence is not an outcome and is counted apart from them: it
          // says what this turn did, not whether anything is true. The next
          // recall re-asserts what is named here.
          const against = kept.diverged ?? [];
          if (against.length > 0) {
            await log(`${tag} · report · went against ${against.length}, re-asserting next turn`);
          }
        } else {
          await log(`${tag} · report · not asked — the payload delivery did not land`);
        }
      }
    } else {
      await log(`${tag} · remember · nothing new to hand over`);
    }
  }

  if (moment === "session-end") await dropSessionCache(sessionId);
  else await keepSessionCache(sessionId, note);

  return result;
}
