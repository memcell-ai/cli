import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = join(process.cwd(), ".memcell", "test-hook-remove-home");

vi.mock("node:os", async (original) => {
  const real = await original<typeof import("node:os")>();
  return { ...real, homedir: () => home };
});

const said: string[] = [];
vi.spyOn(console, "log").mockImplementation((line: unknown) => {
  said.push(String(line));
});

const { hookRemove } = await import("../src/commands/hook.js");
const { saveProject, findProject } = await import("../src/project.js");
const { saveAgentKey, agentKeyFor } = await import("../src/keyring.js");
const { claude } = await import("../src/adapters/claude.js");

// `memcell hook remove` — the inverse of `connect`, scoped to one directory.
//
// What it is judged on: it takes memcell's hooks back out of the agent config,
// forgets the local pointer and key so nothing dangles, and does it against
// wherever the `.memcell` actually sits — not blindly against the cwd.

const out = () => said.join("\n");

async function wired() {
  const dir = await mkdtemp(join(tmpdir(), "memcell-hook-remove-"));
  await saveProject({ instance: "http://x", space: "amber-grove-04821", spaceId: "sp_1" }, dir);
  await saveAgentKey({ instance: "http://x", keyId: "k1", key: "mc_k1", project: dir });
  await claude.install(dir);
  return dir;
}

beforeEach(async () => {
  said.length = 0;
  await rm(home, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("memcell hook remove", () => {
  it("takes the hooks out, forgets the pointer and the key", async () => {
    const dir = await wired();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const code = await hookRemove();
      expect(code).toBe(0);

      // The agent config no longer carries a memcell hook.
      const settings = await readFile(join(dir, ".claude", "settings.json"), "utf8");
      expect(settings).not.toContain("memcell hook");

      // The local pointer and the key are gone — nothing dangles.
      expect(await findProject(dir)).toBeNull();
      expect(await agentKeyFor("http://x", "k1")).toBeNull();

      // It says what it did, names the space, and points at the one command
      // that kills the credential server-side.
      expect(out()).toContain("disconnected");
      expect(out()).toContain("amber-grove-04821");
      expect(out()).toContain("memcell agents revoke k1");
    } finally {
      cwd.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("run against a subdirectory, still finds and unwires the project root", async () => {
    const dir = await wired();
    const sub = join(dir, "src", "deep");
    await mkdir(sub, { recursive: true });
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(sub);
    try {
      await hookRemove();
      const settings = await readFile(join(dir, ".claude", "settings.json"), "utf8");
      expect(settings).not.toContain("memcell hook");
      expect(await findProject(dir)).toBeNull();
    } finally {
      cwd.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says so plainly when the folder was never connected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-bare-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const code = await hookRemove();
      expect(code).toBe(0);
      expect(out()).toContain("nothing wired here");
    } finally {
      cwd.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
