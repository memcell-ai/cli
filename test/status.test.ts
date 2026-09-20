import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-status-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-status-dir-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

let answer: () => unknown = () => ({});

vi.stubGlobal("fetch", async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(answer()),
}));

const { status } = await import("../src/commands/status.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject } = await import("../src/project.js");

const instance = "http://memcell.test";
const cwd = process.cwd;

beforeAll(async () => {
  await saveCredential({
    instance,
    token: "test_session_token",
    obtainedAt: new Date().toISOString(),
  });
  await saveProject({ instance, owner: "memcell", project: "sample", space: "sample" }, projectDir);
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  process.cwd = () => projectDir;
});

describe("status command", () => {
  it("reports 0 when signed in and connected in project directory", async () => {
    answer = () => ({
      user: { id: "u1", name: "Alice", isAnonymous: false },
    });
    const code = await status(instance, "project");
    expect(code).toBe(0);
  });

  it("reports 0 when signed in but not connected in an empty directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "memcell-status-empty-"));
    process.cwd = () => emptyDir;
    answer = () => ({
      user: { id: "u1", name: "Alice", isAnonymous: false },
    });
    const code = await status(instance, "global");
    expect(code).toBe(0);
  });

  it("reports 1 when not signed in", async () => {
    const freshInstance = "http://fresh.memcell.test";
    const code = await status(freshInstance, "global");
    expect(code).toBe(1);
  });
});
