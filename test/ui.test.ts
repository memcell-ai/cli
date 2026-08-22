import { describe, expect, it } from "vitest";

import { bar as blocks, duration, pending } from "../src/ui.js";

// The terminal and the console draw the same reading, so the same
// arithmetic has to hold in both. The bug being pinned here: whole-block
// rounding meant a long crawl could not move its bar for the first twenty
// minutes, and the CLI made it worse by drawing a YIELD (statements over
// items) where progress belonged — a number that stays near zero all run.
//
// Colour is off in this process (no TTY), so what these assert is shape.

const filled = (bar: string) => [...bar].filter((c) => c === "▰").length;
const empty = (bar: string) => [...bar].filter((c) => c === "▱").length;

describe("the terminal meter", () => {
  it("moves on the very first item of a huge total", () => {
    const bar = blocks(1, 6828, 14);
    expect(filled(bar)).toBe(1);
    expect(filled(bar) + empty(bar)).toBe(14);
  });

  it("does not overfill on an exact boundary", () => {
    const bar = blocks(50, 100, 10);
    expect(filled(bar)).toBe(5);
    expect(empty(bar)).toBe(5);
  });

  it("is entirely full at the end", () => {
    const bar = blocks(85, 85, 10);
    expect(filled(bar)).toBe(10);
    expect(empty(bar)).toBe(0);
  });

  it("is entirely empty before anything has happened", () => {
    expect(filled(blocks(0, 6828, 12))).toBe(0);
  });

  it("shows nothing rather than dividing by a total it does not have", () => {
    expect(empty(blocks(5, 0, 12))).toBe(12);
  });

  it("keeps its width while the indeterminate marker travels", () => {
    const a = pending(10, 0);
    const b = pending(10, 3);
    expect(filled(a) + empty(a)).toBe(10);
    expect(a).not.toBe(b);
  });
});

describe("duration", () => {
  it("reads in the unit a person would say", () => {
    expect(duration(4_000)).toBe("4s");
    expect(duration(90_000)).toBe("1m 30s");
    expect(duration(3_600_000)).toBe("1h 00m");
    expect(duration(15_120_000)).toBe("4h 12m");
  });
});

describe("one voice, everywhere", () => {
  it("no command writes around the print system", async () => {
    // The whole point of the segment model: the moment one command assembles
    // its own strings or calls console directly, the voice fragments. The
    // allowed exceptions: ui.ts (the renderer), select.ts (a live prompt
    // redraws in place rather than printing blocks — it renders through the
    // same segments and only the cursor control is its own), bin.ts (the
    // exit code), and main.ts (help/version/refusals — already rendered
    // strings — leaving the process), and hook.ts, whose stdout belongs to
    // an agent's parser rather than to a person.
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const allowed = new Set(["ui.ts", "select.ts", "hook.ts", "bin.ts", "main.ts"]);

    const offenders: string[] = [];
    async function walk(at: string): Promise<void> {
      for (const entry of await readdir(at, { withFileTypes: true })) {
        const full = join(at, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts") && !allowed.has(entry.name)) {
          const source = await readFile(full, "utf8");
          for (const [index, line] of source.split("\n").entries()) {
            if (/console\.|process\.stdout\.write|process\.stderr\.write/.test(line)) {
              offenders.push(`${full}:${index + 1} ${line.trim()}`);
            }
          }
        }
      }
    }
    await walk(join(__dirname, "..", "src"));
    expect(offenders).toEqual([]);
  });

  it("renders depth as indentation and groups with the dim dot", async () => {
    const { render, row, badge, label, value, good } = await import("../src/ui.js");
    // Plain mode in tests (no TTY): the structure must still read.
    const out = render([
      row(0, [badge("memcell"), value("payments")]),
      row(1, [good("linked")], [label("to"), value("avalon")]),
      row(2, [label("undo with"), value("memcell unlink")]),
    ]);
    const lines = out.split("\n");
    // The badge is split into its own group, so identity is separated by
    // the same dot every other pair gets — however the caller grouped it.
    expect(lines[0]).toBe("▧ memcell · payments");
    expect(lines[1]).toBe("  ✓ linked · to avalon");
    expect(lines[2]).toBe("    undo with memcell unlink");
  });

  it("keeps a list to one field, so it never reads as more of the line", async () => {
    const { render, row, label, list, value } = await import("../src/ui.js");
    // The dot separates FIELDS. A list dotted like its neighbours is how
    // "claude · gemini · recall · remember" came to read as one list of four
    // when it was two lists of two.
    const out = render([
      row(1, [label("hooks"), list(["claude", "gemini"])], [label("firing"), value("recall")]),
    ]);
    expect(out).toBe("  hooks claude, gemini · firing recall");
  });

  it("gives a warning its own mark, never the note dot", async () => {
    const { render, row, warn } = await import("../src/ui.js");
    // Fronted by `·` a caution reads as a bullet, and the line looks like a
    // list item.
    expect(render([row(1, [warn("no hooks yet")])])).toBe("  ! no hooks yet");
  });

  it("drops empty rows and empty groups rather than printing separators", async () => {
    const { render, row, label } = await import("../src/ui.js");
    expect(render([row(0), false, null, row(1, null, false, [label("x")])])).toBe("  x");
  });
});

describe("hints name the command the caller can actually run", () => {
  it("an npx invocation rewrites memcell hints to the npx form", async () => {
    const { cmd } = await import("../src/ui.js");
    const held = process.env.npm_execpath;
    process.env.npm_execpath = "/usr/lib/node_modules/npm/bin/npx-cli.js";
    try {
      expect(cmd("memcell connect")).toMatchObject({ t: "npx memcell@latest connect" });
      // Only the leading binary is rewritten — foreign commands pass through.
      expect(cmd("git status")).toMatchObject({ t: "git status" });
    } finally {
      if (held === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = held;
    }
  });

  it("an installed binary keeps its own name", async () => {
    const { cmd } = await import("../src/ui.js");
    const held = process.env.npm_execpath;
    delete process.env.npm_execpath;
    try {
      expect(cmd("memcell connect")).toMatchObject({ t: "memcell connect" });
    } finally {
      if (held !== undefined) process.env.npm_execpath = held;
    }
  });
});
