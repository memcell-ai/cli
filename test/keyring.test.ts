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

const { agentKeyForProject, agentKeys, pruneProjectKeys, saveAgentKey } =
  await import("../src/keyring.js");

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

  it("supersedes previous key for the same agent in the same project", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-supersede-"));
    await saveAgentKey({
      instance: "http://c.test",
      keyId: "k_v1",
      key: "mc_v1",
      project: proj,
      agent: "claude",
    });
    await saveAgentKey({
      instance: "http://c.test",
      keyId: "k_v2",
      key: "mc_v2",
      project: proj,
      agent: "claude",
    });

    const all = await agentKeys();
    const claudeKeys = all.filter((k) => k.instance === "http://c.test" && k.agent === "claude");
    expect(claudeKeys).toHaveLength(1);
    expect(claudeKeys[0]?.keyId).toBe("k_v2");
  });

  it("prunes all keys for a project on a given instance", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-prune-"));
    await saveAgentKey({
      instance: "http://d.test",
      keyId: "k_claude",
      key: "mc_1",
      project: proj,
      agent: "claude",
    });
    await saveAgentKey({
      instance: "http://d.test",
      keyId: "k_antigravity",
      key: "mc_2",
      project: proj,
      agent: "antigravity",
    });

    const prunedCount = await pruneProjectKeys("http://d.test", proj);
    expect(prunedCount).toBe(2);

    expect(await agentKeyForProject("http://d.test", proj, "claude")).toBeNull();
    expect(await agentKeyForProject("http://d.test", proj, "antigravity")).toBeNull();
  });

  it("supersedes keys case-insensitively for the same agent name", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-case-"));
    await saveAgentKey({
      instance: "http://case.test",
      keyId: "k_upper",
      key: "mc_upper",
      project: proj,
      agent: "Claude",
    });
    await saveAgentKey({
      instance: "http://case.test",
      keyId: "k_lower",
      key: "mc_lower",
      project: proj,
      agent: "claude",
    });

    const all = await agentKeys();
    const matches = all.filter(
      (k) => k.instance === "http://case.test" && k.agent?.toLowerCase() === "claude",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.keyId).toBe("k_lower");
  });

  it("pruneProjectKeys strictly isolates the target project without touching others", async () => {
    const projA = await mkdtemp(join(tmpdir(), "memcell-keyring-isoA-"));
    const projB = await mkdtemp(join(tmpdir(), "memcell-keyring-isoB-"));

    await saveAgentKey({
      instance: "http://iso.test",
      keyId: "k_projA",
      key: "mc_A",
      project: projA,
      agent: "claude",
    });
    await saveAgentKey({
      instance: "http://iso.test",
      keyId: "k_projB",
      key: "mc_B",
      project: projB,
      agent: "claude",
    });

    await pruneProjectKeys("http://iso.test", projA);

    // projA must be gone
    expect(await agentKeyForProject("http://iso.test", projA, "claude")).toBeNull();
    // projB must remain intact
    expect((await agentKeyForProject("http://iso.test", projB, "claude"))?.keyId).toBe("k_projB");
  });

  it("agentKeyForProject does not leak another agent's key when a specific agent is requested", async () => {
    const proj = await mkdtemp(join(tmpdir(), "memcell-keyring-specific-"));
    await saveAgentKey({
      instance: "http://spec.test",
      keyId: "k_antigravity",
      key: "mc_ag",
      project: proj,
      agent: "antigravity",
    });

    // Requesting claude when only antigravity is paired must return null, not antigravity's key
    expect(await agentKeyForProject("http://spec.test", proj, "claude")).toBeNull();
    // Requesting antigravity returns antigravity
    expect((await agentKeyForProject("http://spec.test", proj, "antigravity"))?.keyId).toBe(
      "k_antigravity",
    );
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
