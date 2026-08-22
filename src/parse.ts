import { FLAGS, type Command } from "./model.js";

// One parser, driven by what the commands declare.
//
// The old one was positional-only and knew every flag by name in a single
// chain, which meant two things at once: a command wanting a second argument
// had to be special-cased, and a flag that belonged to one command was
// silently accepted by all of them. Both are the same absence — nothing
// described what a command takes, so the parser could not check anything.
//
// Now the command says, and the parser refuses. `--reason` on `logout` is a
// mistake worth naming, because the alternative is a flag that looks like it
// worked.

export type Parse =
  | {
      kind: "run";
      command: Command;
      args: Record<string, string>;
      flags: Flags;
      many: Record<string, string[]>;
    }
  | { kind: "help"; topic?: string }
  | { kind: "version" }
  | { kind: "error"; message: string; hint?: string };

type Flags = Record<string, string | true>;

/** Longest match wins, so `agents revoke` beats `agents`. */
function match(words: string[], commands: Command[]): Command | null {
  let best: Command | null = null;
  for (const command of commands) {
    if (command.path.length > words.length) continue;
    if (command.path.some((word, i) => words[i] !== word)) continue;
    if (!best || command.path.length > best.path.length) best = command;
  }
  return best;
}

export function parse(argv: string[], commands: Command[]): Parse {
  const words: string[] = [];
  const flags: Flags = {};
  // A repeatable flag keeps every value; `flags` still holds the last, so a
  // command that wants one and a command that wants all read the same shape.
  const many: Record<string, string[]> = {};
  // Deferred rather than returned on sight: `--help agents` names its topic
  // AFTER the flag, so answering immediately would always answer the bare
  // screen and quietly ignore what was asked about.
  let wantsHelp = false;
  let wantsVersion = false;
  const byShort = new Map(
    Object.values(FLAGS)
      .filter((f) => f.short)
      .map((f) => [f.short!, f.name]),
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    // Everything after `--` is a positional, whatever it looks like. A
    // statement's text can start with a dash.
    if (arg === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-")) {
      words.push(arg);
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      wantsHelp = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      wantsVersion = true;
      continue;
    }

    const [head, inline] = arg.startsWith("--")
      ? splitOnce(arg.slice(2))
      : [byShort.get(arg.slice(1)) ?? arg.slice(1), undefined];

    const spec = FLAGS[head];
    if (!spec) {
      return { kind: "error", message: `unknown option: ${arg}` };
    }

    if (!spec.takes) {
      if (inline !== undefined) {
        return { kind: "error", message: `--${spec.name} takes no value` };
      }
      flags[spec.name] = true;
      continue;
    }

    const value = inline ?? argv[++i];
    if (value === undefined) {
      return { kind: "error", message: `--${spec.name} needs ${spec.takes}` };
    }
    flags[spec.name] = value;
    if (spec.many) (many[spec.name] ??= []).push(value);
  }

  if (wantsVersion) return { kind: "version" };
  if (wantsHelp) return { kind: "help", topic: words[0] };
  if (words.length === 0) return { kind: "help" };

  const command = match(words, commands);
  if (!command) {
    const known = commands.some((c) => c.path[0] === words[0]);
    // A resource named with no verb is somebody asking what it can do, not
    // a mistake — the same answer `docker container` gives. Only a WRONG
    // verb is an error, and naming the resource separately is the useful
    // half of that message: there is no such verb ON THIS NOUN.
    if (known && words.length === 1) return { kind: "help", topic: words[0] };
    return known
      ? { kind: "error", message: `${words[0]} has no “${words[1]}”`, hint: words[0] }
      : { kind: "error", message: `unknown command: ${words[0]}` };
  }

  // Flags a command did not ask for are refused rather than ignored.
  const takes = new Set(command.takes ?? []);
  for (const name of Object.keys(flags)) {
    if (!takes.has(name)) {
      return {
        kind: "error",
        message: `--${name} means nothing to ${command.path.join(" ")}`,
        hint: command.path[0],
      };
    }
  }

  const positional = words.slice(command.path.length);
  const args: Record<string, string> = {};
  for (const [index, spec] of (command.args ?? []).entries()) {
    if (spec.rest) {
      // The tail is this argument's, however long — `import a.md b.md c.md`.
      const rest = positional.slice(index);
      if (rest.length === 0 && spec.required) {
        return {
          kind: "error",
          message: `${command.path.join(" ")} needs <${spec.name}> — ${spec.what}`,
          hint: command.path[0],
        };
      }
      if (rest[0] !== undefined) args[spec.name] = rest[0];
      if (rest.length > 0) many[spec.name] = rest;
      break;
    }
    const value = positional[index];
    if (value === undefined) {
      if (spec.required) {
        return {
          kind: "error",
          message: `${command.path.join(" ")} needs <${spec.name}> — ${spec.what}`,
          hint: command.path[0],
        };
      }
      continue;
    }
    args[spec.name] = value;
  }

  const extra = command.args?.some((a) => a.rest)
    ? 0
    : positional.length - (command.args?.length ?? 0);
  if (extra > 0) {
    // A resource with sub-verbs mis-reads a bad verb as a surplus argument,
    // and "takes 0 arguments, got 1" sends somebody counting words when the
    // fix is that they named a verb that does not exist.
    const hasVerbs = commands.some(
      (c) => c.path[0] === command.path[0] && c.path.length > command.path.length,
    );
    return {
      kind: "error",
      message:
        hasVerbs && !command.args?.length
          ? `${command.path.join(" ")} has no “${positional[0]}”`
          : `${command.path.join(" ")} takes ${command.args?.length ?? 0} argument(s); got ${positional.length}`,
      hint: command.path[0],
    };
  }

  return { kind: "run", command, args, flags, many };
}

function splitOnce(text: string): [string, string | undefined] {
  const at = text.indexOf("=");
  return at === -1 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)];
}
