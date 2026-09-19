import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-connect-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-connect-dir-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
let answer: () => unknown = () => ({});

vi.stubGlobal(
  "fetch",
  async (
    url: string,
    init: { method?: string; body?: string; headers: Record<string, string> },
  ) => {
    calls.push({
      url,
      method: init.method,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    if (url.includes("/api/auth/get-session")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ user: { id: "u-1", name: "Alice", email: "alice@example.com" } }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(answer()) };
  },
);

const { connect } = await import("../src/commands/connect.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject, findProject } = await import("../src/project.js");
const { agentKeys } = await import("../src/keyring.js");

const instance = "http://memcell.test";
const cwd = process.cwd;

beforeAll(async () => {
  await saveCredential({
    instance,
    token: "test_session_token",
    obtainedAt: new Date().toISOString(),
  });
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  process.cwd = () => projectDir;
});

describe("connect idempotency & self-healing", () => {
  it("re-uses existing project from .memcell when --project is omitted", async () => {
    // Write an existing project file
    await saveProject({ instance, project: "existing-proj", space: "existing-proj" }, projectDir);

    answer = () => ({
      instance,
      project: { id: "p-123", slug: "existing-proj", name: "Existing Project" },
      space: { id: "p-123", slug: "existing-proj", name: "Existing Project" },
      key: "mc_ag_test_key_1",
      keyId: "key-1",
      agentId: "ag-1",
    });

    const code = await connect(instance, { from: "test" });
    expect(code).toBe(0);

    // Assert that /api/v1/connect was called with project: "existing-proj"
    const connectCall = calls.find((c) => c.url.includes("/api/v1/connect"));
    expect(connectCall).toBeDefined();
    expect(connectCall?.body?.project).toBe("existing-proj");

    // Check that keyring holds exactly 1 key for this project
    const keys = await agentKeys();
    const forProj = keys.filter((k) => k.space === "existing-proj");
    expect(forProj.length).toBe(1);
    expect(forProj[0]?.keyId).toBe("key-1");
  });

  it("reconnecting in the same folder rotates the key without leaving orphaned keys", async () => {
    answer = () => ({
      instance,
      project: { id: "p-123", slug: "existing-proj", name: "Existing Project" },
      space: { id: "p-123", slug: "existing-proj", name: "Existing Project" },
      key: "mc_ag_test_key_2",
      keyId: "key-2",
      agentId: "ag-1",
    });

    const code = await connect(instance, { from: "test" });
    expect(code).toBe(0);

    // Keyring should now have key-2 and NOT key-1
    const keys = await agentKeys();
    const forProj = keys.filter((k) => k.space === "existing-proj");
    expect(forProj.length).toBe(1);
    expect(forProj[0]?.keyId).toBe("key-2");
  });

  it("self-heals a corrupted or deleted .memcell file", async () => {
    const freshDir = await mkdtemp(join(tmpdir(), "memcell-fresh-"));
    process.cwd = () => freshDir;

    answer = () => ({
      instance,
      project: { id: "p-fresh", slug: "fresh-proj", name: "Fresh Project" },
      space: { id: "p-fresh", slug: "fresh-proj", name: "Fresh Project" },
      key: "mc_ag_test_key_fresh",
      keyId: "key-fresh",
      agentId: "ag-fresh",
    });

    const code = await connect(instance, { project: "fresh-proj", from: "test" });
    expect(code).toBe(0);

    const found = await findProject(freshDir);
    expect(found).not.toBeNull();
    expect(found?.project.project).toBe("fresh-proj");

    const content = await readFile(join(freshDir, ".memcell"), "utf8");
    expect(content).toContain('slug = "fresh-proj"');
  });

  it("connects with owner/project format and records owner in .memcell", async () => {
    const orgDir = await mkdtemp(join(tmpdir(), "memcell-org-"));
    process.cwd = () => orgDir;

    answer = () => ({
      instance,
      project: { id: "p-org", slug: "analytics", name: "Analytics", ownerSlug: "acme" },
      space: { id: "p-org", slug: "analytics", name: "Analytics", ownerSlug: "acme" },
      key: "mc_ag_test_key_org",
      keyId: "key-org",
      agentId: "ag-org",
    });

    const code = await connect(instance, { project: "acme/analytics", from: "test" });
    expect(code).toBe(0);

    const connectCall = calls.find((c) => c.url.includes("/api/v1/connect"));
    expect(connectCall?.body?.project).toBe("acme/analytics");

    const found = await findProject(orgDir);
    expect(found).not.toBeNull();
    expect(found?.project.owner).toBe("acme");
    expect(found?.project.project).toBe("analytics");

    const content = await readFile(join(orgDir, ".memcell"), "utf8");
    expect(content).toContain('owner = "acme"');
    expect(content).toContain('slug = "analytics"');
  });
});
