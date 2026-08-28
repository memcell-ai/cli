// What the CLI is, stated once so every command inherits it.
//
// The commands used to grow one at a time, and it showed: `keys` was a
// group with a sub-verb, `seed` took a bare positional, the rest were flat
// verbs, and the parser was positional-only — so a command needing two
// arguments had to be special-cased. Three shapes for three commands, and
// each new one had to invent a fourth.
//
// There are exactly two shapes now, and the line between them is not a
// style preference:
//
//   memcell <verb>                 acts on THIS machine or THIS directory
//   memcell <resource> <verb> …    acts on something a memcell holds
//
// A bare verb has nothing to name because its subject is where you are
// standing — `login` is this machine, `connect` is this directory. Everything
// else names the resource it touches, and that name is the same word the
// API path uses and the app route uses. So a verb that cannot say which
// resource it acts on is the signal that the resource model is short one,
// rather than an invitation to name it something.
//
// The two pairs are true inverses, and they are inverses of DIFFERENT
// things:
//
//   login   ⇄ logout        this machine ⇄ an account
//   connect ⇄ hook remove   this directory ⇄ a space, with an agent key
//
// `hook remove` undoes the wiring `connect` made; the key it minted is
// revoked with `agents revoke`, by id, which is why the mint records one.

export interface Argument {
  name: string;
  /** Refusing here, uniformly, beats each command inventing its own message. */
  required?: boolean;
  /** Last argument only: collects every remaining word. The invocation's
   *  `many` record holds the list, same as a repeatable flag's. */
  rest?: boolean;
  what: string;
}

export interface FlagSpec {
  name: string;
  short?: string;
  /** The value's name in help. Absent means it is a switch. */
  takes?: string;
  /** May be given more than once; the invocation collects every value. */
  many?: boolean;
  what: string;
  env?: string;
}

/** Every flag the CLI understands, declared once. A command lists the ones
 *  it accepts, so `--reason` on a command that ignores it is an error rather
 *  than silence. */
export const FLAGS: Record<string, FlagSpec> = {
  instance: {
    name: "instance",
    short: "i",
    takes: "url",
    what: "which memcell to talk to",
    env: "MEMCELL_INSTANCE",
  },
  agent: { name: "agent", takes: "id", what: "the wired agent's id" },
  space: { name: "space", takes: "slug", what: "which space to connect to, by slug" },
  force: { name: "force", short: "f", what: "do it again even if it is already done" },
  "no-browser": {
    name: "no-browser",
    what: "print the link instead of opening one",
    env: "MEMCELL_NO_BROWSER",
  },
  reason: { name: "reason", takes: "why", what: "why the commons should carry it" },
  "no-watch": { name: "no-watch", what: "do not follow the crawl" },
  global: { name: "global", short: "g", what: "this machine, rather than this project" },
  pair: { name: "pair", takes: "id", what: "the pairing shown on the connect page" },
  format: {
    name: "format",
    takes: "kind",
    what: "json · agents-md · claude-md · cursorrules",
  },
  out: { name: "out", short: "o", takes: "file", what: "write here instead of stdout" },
  limit: {
    name: "limit",
    short: "n",
    takes: "count",
    what: "how many MATCHED statements to serve — pins ride on top",
  },
  kind: {
    name: "kind",
    takes: "kind",
    what: "decision · convention · gotcha · dead_end · preference · fact",
  },
  note: { name: "note", takes: "text", what: "what happened, in a sentence" },
  "all-spaces": {
    name: "all-spaces",
    what: "every space this account reaches, not just this directory's",
  },
  // The window, named rather than configured. The instance buckets seven
  // days and serves that; a flag offering thirty would be a window nothing
  // behind it can answer.
  "7d": { name: "7d", what: "the window — the seven days the instance buckets" },
};

export interface Invocation {
  instance: string;
  args: Record<string, string>;
  flags: Record<string, string | true>;
  /** Every value given for a repeatable flag or a rest argument, in order. */
  many: Record<string, string[]>;
}

export interface Command {
  /** `["link"]` or `["agents", "revoke"]` — the words, in order. */
  path: string[];
  what: string;
  /** Machine-facing: absent from help, silent on refusal. The hook is one —
   *  its stdout belongs to an agent's parser, not to a person. */
  hidden?: boolean;
  args?: Argument[];
  /** Keys of `FLAGS`. */
  takes?: string[];
  /** Shown on the bare `memcell` screen. Three, so it tells a story. */
  landing?: boolean;
  run(invocation: Invocation): Promise<number>;
}

/** A resource, so help groups by the noun rather than listing thirty verbs. */
export interface Resource {
  name: string;
  what: string;
}
