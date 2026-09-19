import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { antigravity } from "../src/adapters/antigravity.js";
import { claude } from "../src/adapters/claude.js";
import { cursor } from "../src/adapters/cursor.js";
import { gemini } from "../src/adapters/gemini.js";

// Re-connecting a directory mints a new agent identity. The hook merge never
// clobbers entries that are not memcell's — but memcell's OWN entries must be
// refreshed, or every firing after a re-connect reports the dead agent the
// first pairing minted. Seen live: a reset instance, a re-paired directory,
// and a hook log carrying the old id on every line.

describe("re-install refreshes memcell's own hook command", () => {
  it("claude: one hook per moment, carrying no identity, foreign hooks untouched, deduplicates duplicate hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-claude-"));
    await claude.install(dir);

    // Somebody else's hook beside ours — the thing merge must not clobber.
    // Also inject duplicate memcell hooks to verify self-healing deduplication.
    const at = join(dir, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(at, "utf8")) as {
      hooks: Record<string, { hooks?: { type: string; command: string }[] }[]>;
    };
    settings.hooks.SessionStart!.push({
      hooks: [{ type: "command", command: "echo somebody-elses" }],
    });
    settings.hooks.SessionStart!.push({
      hooks: [{ type: "command", command: "memcell hook session-start claude" }],
    });
    await writeFile(at, JSON.stringify(settings, null, 2));

    await claude.install(dir);

    const after = await readFile(at, "utf8");
    expect(after).not.toContain("--agent");
    expect(after).toContain("memcell hook session-start claude");
    expect(after).toContain("echo somebody-elses");
    // Refreshed and deduplicated — exactly one memcell hook per event (SessionStart and SubagentStart).
    expect(after.match(/hook session-start claude/g)?.length).toBe(2);
    const parsed = JSON.parse(after) as {
      hooks: Record<string, { hooks?: { type: string; command: string }[] }[]>;
    };
    expect(
      parsed.hooks.SessionStart!.filter((g) =>
        g.hooks?.some((h) => h.command.includes("session-start")),
      ).length,
    ).toBe(1);
    expect(
      parsed.hooks.SubagentStart!.filter((g) =>
        g.hooks?.some((h) => h.command.includes("session-start")),
      ).length,
    ).toBe(1);
  });

  it("gemini: the same, in its own dialect with deduplication", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-gemini-"));
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await gemini.install(dir);

    // Inject duplicate entry
    const at = join(dir, ".gemini", "settings.json");
    const settings = JSON.parse(await readFile(at, "utf8")) as {
      hooks: Record<
        string,
        { matcher?: string; hooks?: { name?: string; type: string; command: string }[] }[]
      >;
    };
    settings.hooks.SessionStart!.push({
      matcher: "*",
      hooks: [{ name: "memcell", type: "command", command: "memcell hook session-start gemini" }],
    });
    await writeFile(at, JSON.stringify(settings, null, 2));

    await gemini.install(dir);

    const after = await readFile(at, "utf8");
    expect(after).not.toContain("--agent");
    expect(after.match(/hook session-start gemini/g)?.length).toBe(1);
  });

  it("antigravity: one hook per moment, deduplicates multiple entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-antigravity-"));
    await mkdir(join(dir, ".agents"), { recursive: true });
    await antigravity.install(dir);

    // Inject duplicate entry
    const at = join(dir, ".agents", "hooks.json");
    const config = JSON.parse(await readFile(at, "utf8")) as {
      memcell: { PreInvocation?: { type?: string; command: string }[] };
    };
    config.memcell.PreInvocation!.push({
      type: "command",
      command: "memcell hook prompt-submit antigravity",
    });
    await writeFile(at, JSON.stringify(config, null, 2));

    await antigravity.install(dir);

    const after = await readFile(at, "utf8");
    expect(after.match(/hook prompt-submit antigravity/g)?.length).toBe(1);
  });

  it("cursor: one hook per moment, deduplicates multiple entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-cursor-"));
    await mkdir(join(dir, ".cursor"), { recursive: true });
    await cursor.install(dir);

    // Inject duplicate entry
    const at = join(dir, ".cursor", "hooks.json");
    const config = JSON.parse(await readFile(at, "utf8")) as {
      hooks: { beforeSubmitPrompt?: { command: string }[] };
    };
    config.hooks.beforeSubmitPrompt!.push({
      command: "memcell hook prompt-submit cursor",
    });
    await writeFile(at, JSON.stringify(config, null, 2));

    await cursor.install(dir);

    const after = await readFile(at, "utf8");
    expect(after.match(/hook prompt-submit cursor/g)?.length).toBe(1);
  });
});
