import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-ws-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-ws-dir-"));

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

const { COMMANDS } = await import("../src/commands/index.js");
const { listWorkspaces, newWorkspace, useWorkspace, getWorkspace } =
  await import("../src/commands/workspaces.js");
const { listMemories, createMemory, getMemory, deleteMemory } =
  await import("../src/commands/memories.js");
const { parse } = await import("../src/parse.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject } = await import("../src/project.js");
const { resolveContext } = await import("../src/context.js");

const instance = "http://memcell.test";
const cwd = process.cwd;

beforeAll(async () => {
  await saveCredential({
    instance,
    token: "test_session_token",
    obtainedAt: new Date().toISOString(),
  });
  await saveProject({ instance, owner: "acme", project: "core", space: "core" }, projectDir);
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  process.cwd = () => projectDir;
});

describe("workspaces & memories CLI dispatch", () => {
  it("parses workspace commands cleanly", () => {
    const res1 = parse(["workspaces", "list"], COMMANDS);
    expect(res1.kind).toBe("run");
    if (res1.kind === "run") {
      expect(res1.command.path).toEqual(["workspaces", "list"]);
    }

    const res2 = parse(["workspace", "new", "frontend"], COMMANDS);
    expect(res2.kind).toBe("run");
    if (res2.kind === "run") {
      expect(res2.command.path).toEqual(["workspace", "new"]);
      expect(res2.args.name).toBe("frontend");
    }
  });

  it("parses memories commands cleanly", () => {
    const res1 = parse(["memories", "list"], COMMANDS);
    expect(res1.kind).toBe("run");
    if (res1.kind === "run") {
      expect(res1.command.path).toEqual(["memories", "list"]);
    }

    const res2 = parse(["memory", "create", "Always sanitize input"], COMMANDS);
    expect(res2.kind).toBe("run");
    if (res2.kind === "run") {
      expect(res2.command.path).toEqual(["memory", "create"]);
      expect(res2.args.text).toBe("Always sanitize input");
    }
  });

  it("resolves context with --workspace flag", async () => {
    const context = await resolveContext("http://localhost:3000", {
      workspace: "acme/backend",
    });
    expect(context.project).not.toBeNull();
    expect(context.workspace).not.toBeNull();
    expect(context.project?.owner).toBe("acme");
    expect(context.project?.workspace).toBe("backend");
    expect(context.project?.project).toBe("backend");
    expect(context.project?.namespace).toBe("acme/backend");
  });
});

describe("workspaces commands execution", () => {
  it("lists workspaces and shows active/linked items", async () => {
    answer = () => ({
      activeWorkspace: { slug: "core", name: "Core Engine" },
      workspaces: [
        { id: "ws-1", slug: "core", name: "Core Engine" },
        { id: "ws-2", slug: "docs", name: "Documentation" },
      ],
    });

    const code = await listWorkspaces(instance);
    expect(code).toBe(0);
  });

  it("creates a new workspace via API", async () => {
    answer = () => ({ id: "ws-3", slug: "ml-pipeline", name: "ML Pipeline" });

    const code = await newWorkspace(instance, "ML Pipeline");
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("switches active workspace via useWorkspace", async () => {
    answer = () => ({
      activeWorkspace: { slug: "ml-pipeline", name: "ML Pipeline" },
    });

    const code = await useWorkspace(instance, "ml-pipeline");
    expect(code).toBe(0);
    const patchCall = calls.find((c) => c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall?.body?.workspace).toBe("ml-pipeline");
  });
});

describe("memories commands execution", () => {
  it("lists memories in active workspace", async () => {
    answer = () => ({
      statements: [
        {
          id: "mem-1",
          title: "Production database requires SSL",
          type: "guard",
          scope: "workspace",
          confidence: 0.95,
        },
      ],
      pagination: { total: 1, page: 1, perPage: 30, hasMore: false },
    });

    const code = await listMemories(instance);
    expect(code).toBe(0);
  });

  it("creates a memory directly in workspace", async () => {
    answer = () => ({
      memory: {
        id: "mem-2",
        title: "Keep functions pure when possible",
        type: "directive",
        scope: "workspace",
      },
      statement: {
        id: "mem-2",
        title: "Keep functions pure when possible",
        type: "directive",
        scope: "workspace",
      },
    });

    const code = await createMemory(instance, "Keep functions pure when possible", {
      type: "directive",
    });
    expect(code).toBe(0);
  });

  it("deletes latest version of a memory by default", async () => {
    answer = () => ({
      status: "deleted",
      deletedCount: 1,
      deletedScope: "version",
      nextId: "mem-1",
      restoredVersion: 1,
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await deleteMemory(instance, "mem-2", {});
      expect(code).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/core/memories/mem-2");
    const out = printed.join("\n");
    expect(out).toContain("pruned latest version (restored v1)");
  });

  it("deletes all versions of a memory with --all", async () => {
    answer = () => ({
      status: "deleted",
      deletedCount: 2,
      deletedScope: "memory",
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await deleteMemory(instance, "mem-2", { all: true });
      expect(code).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(
      "http://memcell.test/api/v1/acme/core/memories/mem-2?allVersions=true",
    );
    const out = printed.join("\n");
    expect(out).toContain("deleted");
  });
});
