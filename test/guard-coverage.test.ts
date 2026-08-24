import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Six of these adapters wire into the HOME directory, not the project — so
// a test that installs them all writes into whoever is running it. Home is
// moved somewhere disposable BEFORE anything is imported, which is the only
// ordering that works: the adapters read `homedir()` at call time, but a
// mock registered after the import is too late for a module that captured it.
const home = await mkdtemp(join(tmpdir(), "memcell-guard-home-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

import { adapterFor, allAdapters } from "../src/adapters/index.js";

// Every agent gets the guard, or says in words why it cannot.
//
// The shape this replaces mapped one of memcell's moments to one event name,
// and a missing key meant both "this harness cannot" and "we never wired it".
// Reading the second as the first is how thirteen harnesses that every one of
// them documents a pre-act event came to be described as four.
//
// So the coverage is asserted rather than assumed, and a new adapter that
// forgets the guard fails here instead of quietly guarding nothing.

const names = allAdapters().map((a) => a.name);

/** Every file an install wrote, as one string — the dialects differ, the
 *  question does not. */
async function wroteAll(dir: string): Promise<string> {
  const seen: string[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at).catch(() => [])) {
      const path = join(at, entry);
      if ((await stat(path)).isDirectory()) await walk(path);
      else seen.push(await readFile(path, "utf8").catch(() => ""));
    }
  };
  await walk(dir);
  return seen.join("\n");
}

describe("the guard reaches every agent it can", () => {
  it.each(names)("%s installs its own pre-act event", async (name) => {
    const adapter = adapterFor(name)!;
    const dir = await mkdtemp(join(tmpdir(), `memcell-guard-${name}-`));
    await adapter.install(dir);
    const wrote = (await wroteAll(dir)) + (await wroteAll(home));

    // Each harness spells it its own way; what matters is that SOMETHING
    // fires before an act. The names come from each project's own docs.
    const PRE = /PreToolUse|preToolUse|BeforeTool|before_tool_call|tool\.execute\.before/;
    expect(
      PRE.test(wrote),
      `${name} installed no pre-act hook — if its harness truly has none, say so in its surface instead of leaving it absent`,
    ).toBe(true);
  });
});
