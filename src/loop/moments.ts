// The lifecycle hooks an agent harness can fire at, and which pipeline phase
// of the loop runs at each. One list, so adapters cannot drift.
//
//   session start · prompt submit → recall.   What is already known has to
//     reach the agent BEFORE it acts, or it acts without it.
//   turn end                      → remember. What the turn produced is
//     handed over as transcript delta; the memory engine distills what was durable.
//   turn end · session end        → report.   A statement the turn's own
//     work corroborated is one the recall got right, and saying so is the
//     only thing that moves confidence.
//   before act                    → pre-act guard evaluation. A rule
//     read at the top of a session and needed forty steps later is a rule
//     nobody is holding by the time it applies. This fires before an
//     individual act and evaluates active rules bearing on THAT act. It fires many
//     times a turn, so it costs no call: active rules come down once
//     and the in-memory matching happens locally.

export const LIFECYCLE_HOOKS = [
  "session-start",
  "prompt-submit",
  "before-act",
  "turn-end",
  "session-end",
] as const;
export type LifecycleHook = (typeof LIFECYCLE_HOOKS)[number];

export const isLifecycleHook = (word: string): word is LifecycleHook =>
  (LIFECYCLE_HOOKS as readonly string[]).includes(word);

export type PipelinePhase = "recall" | "remember" | "report";

export const PIPELINE_PHASES: Record<LifecycleHook, PipelinePhase[]> = {
  "session-start": ["recall"],
  "prompt-submit": ["recall"],
  // Evaluated in-memory from active rules held in session cache. No remote phase runs.
  "before-act": [],
  "turn-end": ["remember", "report"],
  "session-end": ["remember", "report"],
};

// Backwards-compatible aliases for legacy terminology
export const MOMENTS = LIFECYCLE_HOOKS;
export type Moment = LifecycleHook;
export const isMoment = isLifecycleHook;
export type Leg = PipelinePhase;
export const LEGS = PIPELINE_PHASES;

/** A path, as every shell reads it — forward slashes (bash on Windows
 *  reads backslashes as escapes) and quoted against spaces. */

/** An entry living in a runner's throwaway cache — `npx`'s content store,
 *  pnpm's dlx dir. A path in there is not an installation and must never be
 *  wired into anyone's config: the cache prunes, the hook dies. */
export const THROWAWAY = /[\\/]_npx[\\/]|[\\/]dlx-|[\\/]\.pnpm-store[\\/]/;

/**
 * The wiring names `memcell` and nothing else.
 *
 * It used to name the exact interpreter and entry running at connect time,
 * because a hook's shell does not always share the PATH of the shell that
 * wired it. That bought reliability with two things worth more: an
 * absolute path from one machine is meaningless on another, so the wiring
 * could not be committed or shared, and it pinned an interpreter that a
 * version manager moves out from under it.
 *
 * `connect` earns the bare word instead — it checks that a hook's own
 * shell can resolve `memcell` and says so plainly when it cannot, rather
 * than leaving a hook to fail silently on every session for the life of
 * the project.
 */

/**
 * The command an adapter writes into an agent's config.
 *
 *   memcell hook <moment> <program>
 *
 * The moment is which of the four fired; the program is which agent's
 * config this is, needed because the output is spoken back in that agent's
 * own dialect. Nothing else — no identity, no paths. The wired agent is
 * resolved at RUN time from the machine keyring, keyed by the directory
 * the hook fired in: an id baked into the command goes stale the moment
 * anybody re-connects, and the hook then reports a dead agent on every
 * firing while looking perfectly well wired.
 *
 * The whole string has to survive a release: at least one agent trusts a hook
 * by hashing its definition and silently skips one that changed since
 * approval, so a format change means reconnecting.
 */
export const hookCommand = (moment: Moment, program: string): string =>
  `memcell hook ${moment} ${program}`;

/** Whether a command is this moment's hook for this program, whatever
 *  invocation leads it and whatever agent id trails it — so a re-install
 *  does not duplicate, an old bare-word wiring is recognised and replaced,
 *  and a check does not miss one wired under a different id. */
export const hookMatches = (command: string, moment: Moment, program: string): boolean =>
  isOurs(command) && command.includes(` hook ${moment} ${program}`);

/** Whether a command is OURS, whatever invocation leads it: the bare word,
 *  an absolute interpreter + entry, or the runner form — all of them carry
 *  our name and our subcommand. Everything else in an agent's config
 *  belongs to the person and is never touched. */
export const isOurs = (command: string): boolean =>
  command.includes("memcell") && command.includes(" hook ");
