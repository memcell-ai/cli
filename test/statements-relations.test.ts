import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-relations-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-relations-dir-"));

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

const { relateStatements, unrelateStatements, statementRelations, getStatement } =
  await import("../src/commands/statements.js");
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
  await saveProject({ instance, project: "acme/research", space: "acme/research" }, projectDir);
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  process.cwd = () => projectDir;
});

describe("statements relations CLI", () => {
  it("relates two statements with a typed edge", async () => {
    answer = () => ({
      relation: {
        id: "rel_123",
        projectId: "proj_1",
        sourceId: "stmt_g1",
        targetId: "stmt_d1",
        relationType: "constrains",
        confidence: 0.95,
      },
    });

    const code = await relateStatements(instance, "stmt_g1", "stmt_d1", {
      type: "constrains",
      confidence: "0.95",
    });

    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    const postCall = calls.find((c) => c.method === "POST" && c.url.includes("/relations"));
    expect(postCall).toBeDefined();
    expect(postCall!.url).toContain("/api/v1/acme/research/statements/stmt_g1/relations");
    expect(postCall!.body?.targetId).toBe("stmt_d1");
    expect(postCall!.body?.relationType).toBe("constrains");
  });

  it("lists statement incoming and outgoing relations", async () => {
    answer = () => ({
      incoming: [
        {
          id: "rel_inc_1",
          projectId: "proj_1",
          sourceId: "stmt_f1",
          targetId: "stmt_d1",
          relationType: "justifies",
          confidence: 0.9,
          sourceStatement: {
            id: "stmt_f1",
            title: "Network timeout is 2000ms",
            type: "fact",
          },
        },
      ],
      outgoing: [
        {
          id: "rel_out_1",
          projectId: "proj_1",
          sourceId: "stmt_d1",
          targetId: "stmt_d2",
          relationType: "depends_on",
          confidence: 0.95,
          targetStatement: {
            id: "stmt_d2",
            title: "Queue worker pool setup",
            type: "directive",
          },
        },
      ],
    });

    const code = await statementRelations(instance, "stmt_d1");
    expect(code).toBe(0);
    const getCall = calls.find((c) => c.method === "GET" && c.url.includes("/relations"));
    expect(getCall).toBeDefined();
    expect(getCall!.url).toContain("/api/v1/acme/research/statements/stmt_d1/relations");
  });

  it("unrelates statements by relation ID", async () => {
    answer = () => ({ ok: true });

    const code = await unrelateStatements(instance, "rel_123");
    expect(code).toBe(0);
    const delCall = calls.find((c) => c.method === "DELETE");
    expect(delCall).toBeDefined();
    expect(delCall!.url).toContain("/relations/rel_123");
  });

  it("unrelates statements by source statement ID and relation ID", async () => {
    answer = () => ({ ok: true });

    const code = await unrelateStatements(instance, "stmt_g1", "rel_123");
    expect(code).toBe(0);
    const delCall = calls.find((c) => c.method === "DELETE");
    expect(delCall).toBeDefined();
    expect(delCall!.url).toContain("/statements/stmt_g1/relations/rel_123");
  });

  it("displays relations hierarchy on getStatement", async () => {
    answer = () => {
      // First call is statement get, second is relations list
      const lastCall = calls[calls.length - 1];
      if (lastCall?.url.includes("/relations")) {
        return {
          incoming: [],
          outgoing: [
            {
              id: "rel_1",
              projectId: "proj_1",
              sourceId: "stmt_g1",
              targetId: "stmt_d1",
              relationType: "constrains",
              confidence: 0.95,
              targetStatement: {
                id: "stmt_d1",
                title: "Develop on topic branch",
                type: "directive",
              },
            },
          ],
        };
      }
      return {
        statement: {
          id: "stmt_g1",
          title: "Never push directly to main",
          confidence: 0.95,
          type: "guard",
          status: "active",
          scope: "common",
        },
      };
    };

    const code = await getStatement(instance, "stmt_g1");
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
