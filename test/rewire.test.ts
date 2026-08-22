import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { claude } from "../src/adapters/claude.js";
import { gemini } from "../src/adapters/gemini.js";

// Re-connecting a directory mints a new agent identity. The hook merge never
// clobbers entries that are not memcell's — but memcell's OWN entries must be
// refreshed, or every firing after a re-connect reports the dead agent the
// first pairing minted. Seen live: a reset instance, a re-paired directory,
// and a hook log carrying the old id on every line.

describe("re-install refreshes memcell's own hook command", () => {
  it("claude: one hook per moment, carrying no identity, foreign hooks untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-claude-"));
    await claude.install(dir);

    // Somebody else's hook beside ours — the thing merge must not clobber.
    const at = join(dir, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(at, "utf8")) as {
      hooks: Record<string, { hooks?: { type: string; command: string }[] }[]>;
    };
    settings.hooks.SessionStart!.push({
      hooks: [{ type: "command", command: "echo somebody-elses" }],
    });
    await writeFile(at, JSON.stringify(settings, null, 2));

    await claude.install(dir);

    const after = await readFile(at, "utf8");
    // The id it used to carry is what went stale on a re-connect. The
    // command names no agent at all now — it is resolved at run time from
    // the keyring — so there is nothing left to refresh.
    expect(after).not.toContain("--agent");
    expect(after).toContain("memcell hook session-start claude");
    expect(after).toContain("echo somebody-elses");
    // Refreshed in place, not appended — one memcell hook per moment.
    expect(after.match(/session-start/g)?.length).toBe(1);
  });

  it("gemini: the same, in its own dialect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-rewire-gemini-"));
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await gemini.install(dir);
    await gemini.install(dir);

    const after = await readFile(join(dir, ".gemini", "settings.json"), "utf8");
    expect(after).not.toContain("--agent");
    expect(after.match(/hook session-start gemini/g)?.length).toBe(1);
  });
});
