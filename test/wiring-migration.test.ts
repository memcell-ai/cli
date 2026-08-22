import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { claude } from "../src/adapters/claude.js";
import { allAdapters, migrateWiring } from "../src/adapters/index.js";
import { hookCommand } from "../src/loop/moments.js";

// Upgrading carries the wiring forward. Two shapes changed: a hook used to
// name an interpreter path and a baked-in agent id, and Claude Code's used
// to live in the settings file its own program rewrites — which is how a
// loop went dead for three days while every surface still said connected.
// Nobody should have to read a changelog to get off either, so any CLI
// entry migrates what it finds.

const legacy = (dir: string) =>
  JSON.stringify({
    permissions: { allow: ["Bash(ls)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `"/Users/someone/.nvm/bin/node" "${dir}/memcell" hook session-start claude --agent old-id`,
              timeout: 30,
            },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "echo somebody-elses-hook", timeout: 30 }] }],
    },
  });

async function wiredTheOldWay(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "memcell-migrate-"));
  await mkdir(join(dir, ".claude"), { recursive: true });
  await writeFile(join(dir, ".claude", "settings.local.json"), legacy(dir));
  return dir;
}

const read = async (at: string) => JSON.parse(await readFile(at, "utf8"));

describe("an older release's wiring is carried forward", () => {
  it("moves out of the file the host rewrites, and takes nothing else with it", async () => {
    const dir = await wiredTheOldWay();
    expect(await claude.stale!(dir)).toBe(true);

    expect(await migrateWiring(dir)).toContain("claude");

    // Wired where the host does not write, in the portable shape.
    const now = await read(join(dir, ".claude", "settings.json"));
    const commands = Object.values(now.hooks as Record<string, { hooks: { command: string }[] }[]>)
      .flat()
      .flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toContain(hookCommand("session-start", "claude"));
    expect(commands.some((c) => c.includes("--agent"))).toBe(false);
    expect(commands.some((c) => c.includes("/"))).toBe(false);

    // The old file keeps everything that was never ours.
    const before = await read(join(dir, ".claude", "settings.local.json"));
    expect(before.permissions.allow).toEqual(["Bash(ls)"]);
    expect(JSON.stringify(before.hooks)).toContain("somebody-elses-hook");
    expect(JSON.stringify(before.hooks)).not.toContain("memcell");

    // And it is done: a second run finds nothing to carry.
    expect(await claude.stale!(dir)).toBe(false);
    expect(await migrateWiring(dir)).toEqual([]);
  });

  it("every adapter can say whether its wiring is stale", async () => {
    // A new adapter that cannot answer would silently never migrate.
    const mute = allAdapters().filter((a) => typeof a.stale !== "function");
    expect(mute.map((a) => a.name)).toEqual([]);
  });

  it("a fresh install is never mistaken for a stale one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memcell-fresh-"));
    await claude.install(dir);
    expect(await claude.stale!(dir)).toBe(false);
  });
});
