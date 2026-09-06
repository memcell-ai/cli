import { homedir } from "node:os";
import { join } from "node:path";

// Everything memcell keeps on THIS computer, and nothing else.
//
// Five modules each worked out `~/.memcell` for themselves — the keyring, the
// credential store, the machine settings, the session notes, the hook log.
// That was fine until something had to know the whole of it: `reset` built on
// five private answers forgets five things and leaves the sixth, and the
// sixth is whatever the next module invents.
//
// So the directory is named here, once, and what lives in it is a list. A new
// file goes in that list or `reset` will not know about it, which is a thing
// a test can check rather than a thing to remember.

/** Where this machine keeps its memcell state. */
export const machineDir = (): string => join(homedir(), ".memcell");

export const machineFile = (...parts: string[]): string => join(machineDir(), ...parts);

/**
 * What memcell holds here, and for the two that cost something, how to get
 * it back.
 *
 * The wording is for somebody deciding whether to clear it, so it says what
 * the thing IS rather than what file holds it — "the sessions that sign this
 * machine in" tells you what you are about to lose; "credentials.json" does
 * not.
 *
 * `then` is only on the entries where losing it means doing something again.
 * A log that rewrites itself and a session note that starts fresh cost
 * nothing, and listing a non-action beside two real ones makes all three
 * read as optional.
 */
export const MACHINE_STATE: readonly { path: string; what: string; then?: string }[] = [
  {
    path: "credentials.json",
    what: "the sessions that sign this machine in",
    then: "sign in again with memcell login",
  },
  {
    path: "agent-keys.json",
    what: "the agent keys held here",
    then: "connect projects again with memcell connect",
  },
  {
    path: "config.json",
    what: "the settings chosen on this machine",
    then: "set them again with memcell config set --global",
  },
  { path: "sessions", what: "what the hooks have seen this session" },
  { path: "hook.log", what: "the log of every hook firing" },
  { path: "last-project", what: "the most recently connected project path" },
] as const;
