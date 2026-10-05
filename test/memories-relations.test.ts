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

const { relateMemories, unrelateMemories, memoryRelations, getMemory } =
  await import("../src/commands/memories.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject } = await import("../src/workspace.js");

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

describe("memories relations CLI", () => {
  it("relates two memories with a typed edge", async () => {
    answer = () => ({
      relation: {
        id: "rel_123",
        workspaceId: "ws_1",
        sourceId: "mem_g1",
        targetId: "mem_d1",
        relationType: "constrains",
        confidence: 0.95,
      },
    });

    const code = await relateMemories(instance, "mem_g1", "mem_d1", {
      type: "constrains",
      confidence: "0.95",
    });

    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    const postCall = calls.find((c) => c.method === "POST" && c.url.includes("/relations"));
    expect(postCall).toBeDefined();
    expect(postCall!.url).toContain("/api/v1/acme/research/memories/mem_g1/relations");
    expect(postCall!.body?.targetId).toBe("mem_d1");
    expect(postCall!.body?.relationType).toBe("constrains");
  });

  it("lists memory incoming and outgoing relations", async () => {
    answer = () => ({
      incoming: [
        {
          id: "rel_inc_1",
          workspaceId: "ws_1",
          sourceId: "mem_f1",
          targetId: "mem_d1",
          relationType: "justifies",
          confidence: 0.9,
          sourceMemory: {
            id: "mem_f1",
            title: "Network timeout is 2000ms",
            type: "fact",
          },
        },
      ],
      outgoing: [
        {
          id: "rel_out_1",
          workspaceId: "ws_1",
          sourceId: "mem_d1",
          targetId: "mem_g1",
          relationType: "constrains",
          confidence: 0.95,
          targetMemory: {
            id: "mem_g1",
            title: "Max retry limit is 3 attempts",
            type: "directive",
          },
        },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await memoryRelations(instance, "mem_d1", {});
      expect(code).toBe(0);
    } finally {
      console.log = log;
    }

    const getCall = calls.find((c) => c.url.includes("/relations"));
    expect(getCall).toBeDefined();
    expect(getCall!.url).toContain("/api/v1/acme/research/memories/mem_d1/relations");

    const out = printed.join("\n");
    expect(out).toContain("memory relations");
    expect(out).toContain("Network timeout is 2000ms");
    expect(out).toContain("Max retry limit is 3 attempts");
  });

  it("unrelates memories by relation ID", async () => {
    answer = () => ({ ok: true, deleted: true });

    const code = await unrelateMemories(instance, "rel_123", undefined, {});
    expect(code).toBe(0);

    const delCall = calls.find((c) => c.method === "DELETE");
    expect(delCall).toBeDefined();
    expect(delCall!.url).toContain("/relations/rel_123");
  });

  it("unrelates memories by source memory ID and relation ID", async () => {
    answer = () => ({ ok: true, deleted: true });

    const code = await unrelateMemories(instance, "mem_g1", "rel_123", {});
    expect(code).toBe(0);

    const delCall = calls.find((c) => c.method === "DELETE");
    expect(delCall).toBeDefined();
    expect(delCall!.url).toContain("/memories/mem_g1/relations/rel_123");
  });

  it("shows relations graph inside getMemory inspector", async () => {
    answer = () => ({
      memory: {
        id: "mem_d1",
        title: "Timeout Directive",
        type: "directive",
        scope: "workspace",
        status: "active",
        confidence: 0.92,
      },
      relations: {
        incoming: [
          {
            id: "rel_1",
            sourceId: "mem_f1",
            targetId: "mem_d1",
            relationType: "justifies",
            confidence: 0.88,
            sourceMemory: {
              id: "mem_f1",
              title: "Network timeout is 2000ms",
              type: "fact",
            },
          },
        ],
        outgoing: [],
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await getMemory(instance, "mem_d1", {});
      expect(code).toBe(0);
    } finally {
      console.log = log;
    }

    const out = printed.join("\n");
    expect(out).toContain("Network timeout is 2000ms");
    expect(out).toContain("justifies");
  });
});
