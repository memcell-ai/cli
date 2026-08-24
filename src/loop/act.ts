// Which moment an act belongs to, decided from the act itself.
//
// The record holds five words every trade shares — read, change, record,
// send, answer — and knows nothing about tools, because it outlives whichever
// agents exist. Turning "the Bash tool, running `git push`" into one of those
// five is knowledge about one harness and one shell, and this is where it is
// allowed to live.
//
// It runs before every tool call, so it costs no call of its own: the rules
// came down once with the turn's recall, and this only decides which of them
// to say now.

import type { Guard } from "../adapters/surface.js";

export type ActClass = "read" | "change" | "record" | "send" | "answer";

/** Commands that put something where it cannot be taken back. Ordered
 *  longest-first so `git push` is not read as `git`. */
const SENDS = [
  "git push",
  "gh pr create",
  "gh pr merge",
  "gh release",
  "gh issue create",
  "npm publish",
  "pnpm publish",
  "yarn publish",
  "fly deploy",
  "docker push",
  "terraform apply",
  "kubectl apply",
  "aws ",
  "curl -X POST",
  "curl -X PUT",
  "curl -X DELETE",
  "mail ",
  "sendmail",
];

/** Commands that make something durable for one's own side. */
const RECORDS = ["git commit", "git merge", "git tag", "git checkout -b", "git branch"];

/** Commands that only look. */
const READS = ["git status", "git log", "git diff", "git show", "ls ", "cat ", "grep ", "find "];

const has = (haystack: string, needles: string[]) => needles.some((n) => haystack.includes(n));

/**
 * The moment this act belongs to, or null when nothing can be said honestly.
 *
 * A shell command is whichever of these it is; the tool name alone cannot
 * say, because one tool runs all of them. Everything else is decided by the
 * name, which is what the adapter's own table is for.
 *
 * Null is a real answer and the common one. A guess here is worse than
 * silence: it puts a rule about publishing in front of somebody listing a
 * directory, and the next rule they see is one they have learned to skip.
 */
export function actOf(
  tool: string,
  input: Record<string, unknown> | undefined,
  guard: Guard,
): ActClass | null {
  const named = (Object.entries(guard.tools) as [ActClass, string[]][]).filter(([, tools]) =>
    tools.includes(tool),
  );
  if (named.length === 0) return null;
  // One class claims it: the tool IS that act, whatever its arguments.
  if (named.length === 1) return named[0]![0];

  // Several claim it, which is how a shell is declared — it is genuinely all
  // of them, and only the command says which.
  const command = String(input?.command ?? input?.cmd ?? input?.script ?? "").toLowerCase();
  if (!command) return null;
  if (has(command, SENDS)) return "send";
  if (has(command, RECORDS)) return "record";
  if (has(command, READS)) return "read";
  // A shell command this build has no opinion about. Silence.
  return null;
}
