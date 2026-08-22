import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Which agents a link is for. Two things carry the weight: detection is a
// question with a true answer rather than a guess at PATH, and a prompt is
// only ever offered where somebody can answer it — asking with no reader
// hangs a build forever, so the caller is told there was nobody to ask and
// decides for itself.

const home = await mkdtemp(join(tmpdir(), "memcell-agents-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const { AGENTS, agentNamed, detected } = await import("../src/agents.js");
const { pick } = await import("../src/select.js");

beforeAll(async () => {
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(home, ".config", "opencode"), { recursive: true });
});

describe("the catalogue", () => {
  it("names every agent once, in lowercase, with no duplicates", () => {
    const names = AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n === n.toLowerCase())).toBe(true);
  });

  it("finds an agent however it was typed", () => {
    expect(agentNamed("CLAUDE")?.label).toBe("claude code");
    expect(agentNamed("gemini")?.name).toBe("gemini");
    expect(agentNamed("nonesuch")).toBeUndefined();
  });
});

describe("detection", () => {
  it("finds the agents this machine has actually used", async () => {
    const found = await detected();
    expect(found.has("claude")).toBe(true);
    // Nested config homes count the same as top-level ones.
    expect(found.has("opencode")).toBe(true);
  });

  it("does not invent the ones it has not", async () => {
    const found = await detected();
    expect(found.has("codex")).toBe(false);
    expect(found.has("cursor")).toBe(false);
  });

  it("never throws — an unreadable home is 'not detected', not a crash", async () => {
    await expect(detected()).resolves.toBeInstanceOf(Set);
  });
});

describe("asking", () => {
  it("answers null where there is nobody to ask, rather than waiting", async () => {
    // No TTY under a test runner — the same shape as CI, a pipe, or a
    // script. A prompt here would never return.
    const answer = await pick("which agents?", [{ name: "claude", label: "claude code" }]);
    expect(answer).toBeNull();
  });

  it("answers an empty list for an empty question without asking anything", async () => {
    expect(await pick("which agents?", [])).toEqual([]);
  });
});
