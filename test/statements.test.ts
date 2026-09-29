import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-statements-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-statements-dir-"));

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

const {
  listStatements,
  getStatement,
  createStatement,
  updateStatement,
  deleteStatement,
  starStatement,
  historyStatement,
  adoptStatement,
} = await import("../src/commands/statements.js");
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

describe("statements list", () => {
  it("lists statements for the connected project namespace", async () => {
    answer = () => ({
      items: [
        {
          id: "stmt_1",
          title: "Operating temperature threshold is 45C.",
          confidence: 0.92,
          type: "directive",
          scope: "hardware",
          status: "active",
        },
      ],
      pagination: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listStatements(instance, {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/v1/acme/research/statements");
    const out = printed.join("\n");
    expect(out).toContain("Operating temperature threshold is 45C.");
    expect(out).toContain("directive");
  });
});

describe("statements get", () => {
  it("fetches a single statement by id", async () => {
    answer = () => ({
      statement: {
        id: "stmt_1",
        title: "Operating temperature threshold is 45C.",
        confidence: 0.92,
        type: "directive",
        scope: "hardware",
        status: "active",
        starCount: 3,
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await getStatement(instance, "stmt_1", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements/stmt_1");
    const out = printed.join("\n");
    expect(out).toContain("Operating temperature threshold is 45C.");
    expect(out).toContain("stmt_1");
  });
});

describe("statements create", () => {
  it("creates a new statement with type and scope", async () => {
    answer = () => ({
      statement: {
        id: "stmt_2",
        title: "Backup schedules trigger at midnight UTC.",
        confidence: 0.85,
        type: "preference",
        scope: "operations",
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(
        await createStatement(instance, "Backup schedules trigger at midnight UTC.", {
          type: "preference",
          scope: "operations",
        }),
      ).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements");
    expect(calls[0]!.body?.title).toBe("Backup schedules trigger at midnight UTC.");
    const out = printed.join("\n");
    expect(out).toContain("created");
    expect(out).toContain("stmt_2");
  });
});

describe("statements update", () => {
  it("patches statement properties", async () => {
    answer = () => ({
      statement: {
        id: "stmt_2",
        title: "Backup schedules trigger at 01:00 UTC.",
        confidence: 0.95,
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(
        await updateStatement(instance, "stmt_2", {
          text: "Backup schedules trigger at 01:00 UTC.",
          confidence: "0.95",
        }),
      ).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements/stmt_2");
    const out = printed.join("\n");
    expect(out).toContain("updated");
  });
});

describe("statements delete", () => {
  it("deletes a statement by id", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await deleteStatement(instance, "stmt_2", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements/stmt_2");
    const out = printed.join("\n");
    expect(out).toContain("deleted");
  });
});

describe("statements star", () => {
  it("stars or unstars a statement", async () => {
    answer = () => ({ ok: true, starred: true, starCount: 4 });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await starStatement(instance, "stmt_1", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements/stmt_1/star");
    const out = printed.join("\n");
    expect(out).toContain("starred");
  });
});

describe("statements history", () => {
  it("fetches statement change history", async () => {
    answer = () => ({
      items: [
        {
          id: "hist_1",
          statementId: "stmt_1",
          action: "created",
          createdAt: new Date().toISOString(),
        },
      ],
      pagination: { total: 1 },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await historyStatement(instance, "stmt_1", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "http://memcell.test/api/v1/acme/research/statements/stmt_1/history",
    );
    const out = printed.join("\n");
    expect(out).toContain("history");
    expect(out).toContain("created");
  });
});

describe("statements adopt", () => {
  it("adopts a statement into another project", async () => {
    answer = () => ({
      adopted: [{ targetProjectId: "acme/edge", statementId: "stmt_adopted_1" }],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await adoptStatement(instance, "stmt_1", { into: "acme/edge" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/statements/stmt_1/adopt");
    const out = printed.join("\n");
    expect(out).toContain("adopted");
    expect(out).toContain("stmt_adopted_1");
  });
});
