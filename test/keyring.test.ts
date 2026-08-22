import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Identity lives in the machine keyring, found by the wired DIRECTORY — the
// project file names the memory, never the person. What is pinned: the
// lookup matches on instance + project dir, a trailing slash does not split
// an instance in two, and when reconnects have piled up the pairing made
// last is the one that answers.

const home = await mkdtemp(join(tmpdir(), "memcell-keyring-home-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const { agentKeyForProject, saveAgentKey } = await import("../src/keyring.js");

describe("finding the pairing by directory", () => {
  it("matches instance + project, and the newest pairing wins", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-proj-"));
    await saveAgentKey({
      instance: "http://a.test",
      keyId: "k_old",
      key: "mc_old",
      project: proj,
      agentId: "agent-old",
    });
    await saveAgentKey({
      instance: "http://a.test",
      keyId: "k_new",
      key: "mc_new",
      project: proj,
      agentId: "agent-new",
    });
    await saveAgentKey({
      instance: "http://other.test",
      keyId: "k_other",
      key: "mc_other",
      project: proj,
    });

    const held = await agentKeyForProject("http://a.test", proj);
    expect(held?.keyId).toBe("k_new");
    expect(held?.agentId).toBe("agent-new");
  });

  it("a trailing slash is the same instance", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-slash-"));
    await saveAgentKey({ instance: "http://b.test", keyId: "k1", key: "mc_1", project: proj });
    expect((await agentKeyForProject("http://b.test/", proj))?.keyId).toBe("k1");
  });

  it("answers nothing for a directory this machine never paired", async () => {
    expect(
      await agentKeyForProject("http://a.test", await mkdtemp(join(tmpdir(), "memcell-nowhere-"))),
    ).toBeNull();
  });
});
