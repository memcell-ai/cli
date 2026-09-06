import { describe, expect, it } from "vitest";

import { parse } from "../src/parse.js";
import type { Command } from "../src/model.js";

// The parser is where the CLI's shape is enforced, so what is pinned here is
// the shape rather than the wiring: two forms, flags a command did not ask
// for refused rather than ignored, and every missing argument refused the
// same way.
//
// The old parser could do none of this. It was positional-only and knew
// every flag in one chain, so a command needing two arguments was
// special-cased and `--reason` was accepted by everything. Both are the same
// absence — nothing described what a command takes.

const noop = async () => 0;

const COMMANDS: Command[] = [
  { path: ["login"], what: "sign in", takes: ["url", "force"], run: noop },
  { path: ["wire"], what: "wire", takes: ["url", "reason"], run: noop },
  { path: ["spaces", "ls"], what: "list", takes: ["url"], run: noop },
  {
    path: ["spaces", "use"],
    what: "switch",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: noop,
  },
  {
    path: ["spaces", "new"],
    what: "make",
    args: [{ name: "name", required: true, what: "what it holds" }],
    takes: [],
    run: noop,
  },
  {
    path: ["bring"],
    what: "bring many",
    args: [{ name: "files", rest: true, what: "any number of them" }],
    takes: [],
    run: noop,
  },
];

const run = (line: string) => parse(line.split(" ").filter(Boolean), COMMANDS);

describe("the two shapes", () => {
  it("takes a bare verb", () => {
    const parsed = run("login");
    expect(parsed.kind).toBe("run");
    expect(parsed.kind === "run" && parsed.command.path).toEqual(["login"]);
  });

  it("prefers the longest matching path, so a sub-verb wins over its noun", () => {
    const parsed = run("spaces use api");
    expect(parsed.kind === "run" && parsed.command.path).toEqual(["spaces", "use"]);
    expect(parsed.kind === "run" && parsed.args.slug).toBe("api");
  });

  it("answers a bare noun with that noun's verbs, the way docker does", () => {
    // Naming a resource with no verb is asking what it can do, not a
    // mistake — so it is help, not a refusal.
    const parsed = run("spaces");
    expect(parsed.kind).toBe("help");
    expect(parsed.kind === "help" && parsed.topic).toBe("spaces");
  });
});

describe("refusals", () => {
  it("names an unknown verb ON its noun rather than counting arguments", () => {
    const parsed = run("spaces frobnicate");
    expect(parsed.kind).toBe("error");
    // The old message was "takes 0 arguments; got 1", which sends somebody
    // counting words when the fix is that the verb does not exist.
    expect(parsed.kind === "error" && parsed.message).toContain("has no");
    expect(parsed.kind === "error" && parsed.message).toContain("frobnicate");
  });

  it("refuses a flag the command did not ask for", () => {
    const parsed = run("login --reason api");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain("means nothing to login");
  });

  it("refuses a required argument's absence, saying what it is for", () => {
    const parsed = run("spaces use");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain("<slug>");
    expect(parsed.kind === "error" && parsed.message).toContain("from the list");
  });

  it("refuses an unknown option rather than treating it as a word", () => {
    const parsed = run("login --nope");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain("unknown option");
  });

  it("refuses a value on a switch", () => {
    const parsed = run("login --force=yes");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain("takes no value");
  });

  it("refuses a valued flag with nothing after it", () => {
    const parsed = run("wire --reason");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain("needs why");
  });
});

describe("flags", () => {
  it("reads a value as the next word or after an equals, identically", () => {
    for (const line of ["wire --reason api", "wire --reason=api"]) {
      const parsed = run(line);
      expect(parsed.kind === "run" && parsed.flags.reason).toBe("api");
    }
  });

  it("reads a short flag as its long name", () => {
    const parsed = run("login -f");
    expect(parsed.kind === "run" && parsed.flags.force).toBe(true);
  });

  it("takes a flag before the command as readily as after it", () => {
    const parsed = run("--reason api wire");
    expect(parsed.kind === "run" && parsed.command.path).toEqual(["wire"]);
    expect(parsed.kind === "run" && parsed.flags.reason).toBe("api");
  });
});

describe("help and version", () => {
  it("answers the bare invocation with the overview", () => {
    expect(parse([], COMMANDS).kind).toBe("help");
  });

  it("carries the topic when it is named after the flag", () => {
    // The reason help is deferred rather than answered on sight: `--help
    // spaces` names its topic afterwards, so returning immediately would
    // always answer the bare screen.
    const parsed = run("--help spaces");
    expect(parsed.kind).toBe("help");
    expect(parsed.kind === "help" && parsed.topic).toBe("spaces");
  });

  it("carries the topic when the flag comes last", () => {
    const parsed = run("spaces --help");
    expect(parsed.kind === "help" && parsed.topic).toBe("spaces");
  });

  it("answers help before running, even on a line that would otherwise refuse", () => {
    const parsed = run("spaces use --help");
    expect(parsed.kind).toBe("help");
  });

  it("stops treating words as flags after a bare double dash", () => {
    const parsed = run("spaces new -- --force");
    expect(parsed.kind === "run" && parsed.args.name).toBe("--force");
  });
});

describe("a rest argument", () => {
  it("collects every remaining word, in order", () => {
    const parsed = run("bring a.md b.md c.json");
    expect(parsed.kind).toBe("run");
    expect(parsed.kind === "run" && parsed.many.files).toEqual(["a.md", "b.md", "c.json"]);
    expect(parsed.kind === "run" && parsed.args.files).toBe("a.md");
  });

  it("an optional rest argument may be absent", () => {
    const parsed = run("bring");
    expect(parsed.kind).toBe("run");
    expect(parsed.kind === "run" && parsed.many.files).toBeUndefined();
  });

  it("never trips the surplus-argument refusal", () => {
    const parsed = run("bring one two three four five");
    expect(parsed.kind).toBe("run");
  });
});
