import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-upgrade-home-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

import { adapterFor, allAdapters, migrateWiring } from "../src/adapters/index.js";

// An upgrade that adds a moment carries itself forward.
//
// The migration already runs on every entry INCLUDING the hook firings, so a
// project that fires any hook after an upgrade rewires itself. That only
// works if something notices, and for a long time nothing did: every check
// asked whether the wiring was the wrong SHAPE, and wiring that is the right
// shape and simply one moment short passes all of them. Hooks current,
// portable, and quietly missing the moment the release exists to add.
//
// Nobody reads a changelog before opening their editor. This is the property
// that makes that fine.

describe("a project wired by an older release", () => {
  it.each(allAdapters().map((a) => a.name))("%s notices a moment it never wired", async (name) => {
    const adapter = adapterFor(name)!;
    const dir = await mkdtemp(join(tmpdir(), `memcell-upgrade-${name}-`));

    // Wire it as this release does, then take one moment back out — which is
    // exactly the state an older release leaves behind.
    await adapter.install(dir);
    const touched: string[] = [];
    for (const at of [dir, home]) {
      const { readdir, stat } = await import("node:fs/promises");
      const walk = async (root: string): Promise<void> => {
        for (const entry of await readdir(root).catch(() => [])) {
          const path = join(root, entry);
          if ((await stat(path)).isDirectory()) await walk(path);
          else touched.push(path);
        }
      };
      await walk(at);
    }
    const wrote = touched.filter(async (f) => (await readFile(f, "utf8")).includes("memcell"));
    expect(wrote.length, `${name} wrote nothing`).toBeGreaterThan(0);

    // An older release wired every moment it KNEW — so the file is valid
    // and complete for its time, and simply has no entry for this one.
    // Renaming the event reproduces that exactly; deleting lines would only
    // produce a broken file, which is a different bug with a different fix.
    const PRE = /PreToolUse|preToolUse|BeforeTool|before_tool_call|tool\.execute\.before/g;
    let stripped = false;
    for (const at of touched) {
      const text = await readFile(at, "utf8").catch(() => "");
      if (!PRE.test(text)) continue;
      await writeFile(at, text.replace(PRE, "AnOlderReleaseKnewNothingOfThis"));
      stripped = true;
    }
    expect(stripped, `${name} never wired a pre-act event`).toBe(true);

    // The next entry — a hook firing is one — carries it forward.
    const carried = await migrateWiring(dir);
    expect(carried, `${name} did not notice the missing moment`).toContain(name);

    const after = (await Promise.all(touched.map((f) => readFile(f, "utf8").catch(() => "")))).join(
      "\n",
    );
    expect(
      /PreToolUse|preToolUse|BeforeTool|before_tool_call|tool\.execute\.before/.test(after),
      `${name} migrated but did not restore the moment`,
    ).toBe(true);
  });
});
