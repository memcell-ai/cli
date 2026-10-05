import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-promotions-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-promotions-dir-"));

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
    return { ok: true, status: 200, text: async () => JSON.stringify(answer()) };
  },
);

const { listPromotions, approvePromotion, rejectPromotion } =
  await import("../src/commands/promotions.js");
const { promote } = await import("../src/commands/promote.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject } = await import("../src/workspace.js");
const { saveAgentKey } = await import("../src/keyring.js");

const instance = "http://memcell.test";
const cwd = process.cwd;

beforeAll(async () => {
  await saveCredential({
    instance,
    token: "test_session_token",
    obtainedAt: new Date().toISOString(),
  });
  await saveProject({ instance, project: "acme/research", space: "acme/research" }, projectDir);
  await saveAgentKey({
    instance,
    keyId: "key_1",
    key: "agent_key",
    project: "acme/research",
    projectPath: projectDir,
  });
  process.cwd = () => projectDir;
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  answer = () => ({});
});

describe("promotions command group & 4-tier scope promotion", () => {
  it("lists pending promotions via listPromotions", async () => {
    answer = () => ({
      requests: [
        {
          id: "req_1",
          statementId: "stmt_1",
          fromScope: "user",
          toScope: "project",
          status: "pending",
          requestedBy: "usr_alice",
          reason: "Team baseline",
          statement: { id: "stmt_1", title: "Always type strictly" },
        },
      ],
      total: 1,
    });

    const code = await listPromotions(instance, { status: "pending" });
    expect(code).toBe(0);
    expect(
      calls.some((c) => c.url.includes("/api/v1/acme/research/promotions?status=pending")),
    ).toBe(true);
  });

  it("approves a promotion request", async () => {
    answer = () => ({
      approved: true,
      statement: {
        id: "stmt_1",
        title: "Always type strictly",
        scope: "project",
      },
    });

    const code = await approvePromotion(instance, "req_1", "Approved for project");
    expect(code).toBe(0);
    const approveCall = calls.find((c) => c.url.includes("/promotions/req_1/approve"));
    expect(approveCall).toBeDefined();
    expect(approveCall?.method).toBe("POST");
    expect(approveCall?.body).toMatchObject({ reviewReason: "Approved for project" });
  });

  it("rejects a promotion request", async () => {
    answer = () => ({
      rejected: true,
      requestId: "req_1",
    });

    const code = await rejectPromotion(instance, "req_1", "Out of scope");
    expect(code).toBe(0);
    const rejectCall = calls.find((c) => c.url.includes("/promotions/req_1/reject"));
    expect(rejectCall).toBeDefined();
    expect(rejectCall?.method).toBe("POST");
    expect(rejectCall?.body).toMatchObject({ reviewReason: "Out of scope" });
  });

  it("handles direct statement promotion in promote command", async () => {
    answer = () => ({
      promoted: true,
      statement: {
        id: "stmt_1",
        title: "Always type strictly",
        scope: "project",
        version: 2,
      },
    });

    const code = await promote("stmt_1", "project", "Standardizing", instance);
    expect(code).toBe(0);
    const promoCall = calls.find((c) => c.url.includes("/memories/stmt_1/promote"));
    expect(promoCall).toBeDefined();
    expect(promoCall?.body).toMatchObject({ toScope: "workspace", reason: "Standardizing" });
  });

  it("handles review-requested statement promotion in promote command", async () => {
    answer = () => ({
      promoted: false,
      promotionRequest: {
        id: "req_org_1",
        statementId: "stmt_1",
        fromScope: "project",
        toScope: "organization",
        status: "pending",
      },
    });

    const code = await promote("stmt_1", "organization", "Org wide standard", instance);
    expect(code).toBe(0);
    const promoCall = calls.find((c) => c.url.includes("/memories/stmt_1/promote"));
    expect(promoCall).toBeDefined();
    expect(promoCall?.body).toMatchObject({ toScope: "organization", reason: "Org wide standard" });
  });
});
