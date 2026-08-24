import { dirname } from "node:path";

import { adapterFor, removeHooks } from "../adapters/index.js";
import { agentKeyForProject, forgetAgentKey } from "../keyring.js";
import { runMoment } from "../loop/hook.js";
import { isMoment, MOMENTS } from "../loop/moments.js";
import { log } from "../loop/session.js";
import { findProject, removeProject } from "../project.js";
import { badge, cmd, good, label, list, place, row, say, value } from "../ui.js";

// `memcell hook <moment> <program> --agent <id>` — what an installed hook runs.
//
// The program is which agent's config this is, and decides the output
// dialect. `--agent` is the wired agent's id — carried for attribution and
// later use, logged so a firing is traceable to it.
//
// Machine-facing: stdout belongs to the agent's parser, and at least one
// agent treats any stray line as breaking the whole output. So nothing here
// speaks the CLI's voice; the only thing ever written is the agent's own
// dialect, or nothing at all.

export async function hook(moment: string, program: string): Promise<number> {
  // A wrong invocation still exits 0. This runs inside somebody's session,
  // and failing closed over a typo in a config file would break their agent
  // to report our mistake. It is written down, though: silence made a typo'd
  // moment look exactly like a hook that was never installed.
  if (!isMoment(moment)) {
    await log(`${moment} ${program} · not a moment · one of ${MOMENTS.join(", ")}`);
    return 0;
  }

  // THE HOOK BOUNDARY. Nothing may cross it.
  //
  // This process is the user's coding agent calling out mid-turn. Anything
  // thrown from here exits non-zero with a Node stack trace in their
  // terminal, and some harnesses treat that as the turn failing — memory
  // breaking the work it exists to help. Fail open means fail open: the
  // trouble is written to the log and the moment produces nothing.
  let result: Awaited<ReturnType<typeof runMoment>>;
  try {
    result = await runMoment(moment, program);
  } catch (trouble) {
    await log(`${moment} ${program} · fell over · ${(trouble as Error)?.message ?? trouble}`);
    return 0;
  }
  const adapter = adapterFor(program);

  // A rule somebody asked to STOP this act. Spoken in the harness's own
  // refusal, and the reason is always the rule's own words — nobody is
  // stopped without being told what stopped them.
  //
  // This is the ONE place the loop is allowed to stand in the way, and only
  // because a person turned it on for that rule. Everything else fails open:
  // a hook that blocks work it should not is a hook that gets removed, and a
  // removed hook remembers nothing at all.
  if (result.refuse) {
    const spoken = adapter?.refuse?.(result.refuse) ?? null;
    if (spoken) {
      process.stdout.write(spoken);
      return 0;
    }
    // No dialect for refusing here: exit 2 with the reason on stderr, which
    // every harness surveyed reads as "do not run this, and tell the model
    // why". An agent this build does not know still gets silence.
    if (adapter) {
      process.stderr.write(result.refuse);
      return 2;
    }
    return 0;
  }

  // The adapter owns the dialect. An agent this build does not know gets
  // silence, never a guess — a wrong dialect is worse than a dropped
  // injection.
  const spoken = adapter?.speak(moment, result.context ?? null, result.heard) ?? null;
  if (spoken) process.stdout.write(spoken);
  return 0;
}

// `memcell hook remove` — the inverse of what `connect` wired here, scoped to
// this directory. Unlike the runner above this one talks to a person, so it
// speaks the CLI's voice.
//
// It takes memcell's hooks out of every agent config in this project and drops
// the local `.memcell` pointer and this machine's copy of the key. It does NOT
// reach the server: the key was minted through a pairing that never signed
// this machine in, so there is usually no session to revoke with — and a
// surviving key is said out loud, with the one command that kills it, rather
// than left silent.
export async function hookRemove(): Promise<number> {
  const found = await findProject();
  if (!found) {
    say(
      row(0, [badge("memcell"), place(process.cwd())]),
      row(1, [label("nothing wired here")], [label("this folder is not connected")]),
    );
    return 0;
  }

  const { project, at } = found;
  const here = dirname(at);
  const removed = await removeHooks(here);
  // Identity lives in the keyring now — find it by the directory before the
  // pointer to it goes.
  const held = await agentKeyForProject(project.instance, here);
  if (held) await forgetAgentKey(held.instance, held.keyId);
  await removeProject(at);

  say(
    row(0, [badge("memcell"), value(project.space)]),
    row(1, [good("disconnected")], [place(here)]),
    removed.length > 0
      ? row(1, [good("hooks removed")], [list(removed)])
      : row(2, [label("no hook files here")]),
    held ? row(2, [label("key still lives")], [cmd(`memcell agents revoke ${held.keyId}`)]) : null,
  );
  return 0;
}
