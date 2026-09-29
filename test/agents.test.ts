import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-agents-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-agents-dir-"));

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
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  createAgentKey,
  revokeAgentKey,
  verifyAgents,
} = await import("../src/commands/agents.js");
const { saveCredential } = await import("../src/instance.js");
const { saveProject } = await import("../src/project.js");
const { claude } = await import("../src/adapters/claude.js");
const { installSkill } = await import("../src/adapters/skill.js");

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

describe("agents list", () => {
  it("lists project agents when project is specified", async () => {
    answer = () => ({
      agents: [
        {
          id: "ag_1",
          name: "ResearcherBot",
          status: "active",
          kind: "autonomous",
          description: "Synthesizes market data",
        },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listAgents(instance, { project: "acme/research" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents");
    const out = printed.join("\n");
    expect(out).toContain("ResearcherBot");
    expect(out).toContain("Synthesizes market data");
    expect(out).toContain("ag_1");
  });
});

describe("agents get", () => {
  it("fetches a specific agent by ID", async () => {
    answer = () => ({
      agent: {
        id: "ag_1",
        name: "ResearcherBot",
        status: "active",
        description: "Synthesizes market data",
        createdAt: new Date().toISOString(),
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await getAgent(instance, "ag_1", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents/ag_1");
    const out = printed.join("\n");
    expect(out).toContain("ResearcherBot");
    expect(out).toContain("ag_1");
  });
});

describe("agents create", () => {
  it("registers a new agent in the project", async () => {
    answer = () => ({
      agent: {
        id: "ag_2",
        name: "IngestionAgent",
        description: "Collects telemetry",
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(
        await createAgent(instance, "IngestionAgent", {
          description: "Collects telemetry",
          type: "autonomous",
        }),
      ).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents");
    expect(calls[0]!.body).toEqual({
      name: "IngestionAgent",
      description: "Collects telemetry",
      kind: "autonomous",
    });
    const out = printed.join("\n");
    expect(out).toContain("registered");
    expect(out).toContain("IngestionAgent");
    expect(out).toContain("ag_2");
  });
});

describe("agents update", () => {
  it("updates an existing agent", async () => {
    answer = () => ({
      agent: {
        id: "ag_2",
        name: "IngestionAgentV2",
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await updateAgent(instance, "ag_2", { name: "IngestionAgentV2" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents/ag_2");
    expect(calls[0]!.body).toEqual({ name: "IngestionAgentV2" });
    const out = printed.join("\n");
    expect(out).toContain("updated");
    expect(out).toContain("IngestionAgentV2");
  });
});

describe("agents delete", () => {
  it("deletes an agent from the project", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await deleteAgent(instance, "ag_2", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents/ag_2");
    const out = printed.join("\n");
    expect(out).toContain("deleted");
    expect(out).toContain("ag_2");
  });
});

describe("agents key create", () => {
  it("mints a new key for an agent", async () => {
    answer = () => ({
      key: {
        id: "key_abc",
        key: "mc_agent_secret_key_123",
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await createAgentKey(instance, "ag_1", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents/ag_1/keys");
    const out = printed.join("\n");
    expect(out).toContain("minted key");
    expect(out).toContain("key_abc");
    expect(out).toContain("mc_agent_secret_key_123");
  });
});

describe("agents key revoke", () => {
  it("revokes an agent key with explicit agentId and keyId", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await revokeAgentKey(instance, "ag_1", "key_abc", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/agents/ag_1/keys/key_abc");
    const out = printed.join("\n");
    expect(out).toContain("revoked");
    expect(out).toContain("key_abc");
  });
});

describe("agents --verify", () => {
  it("warns when no agents are wired in directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "memcell-empty-"));
    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await verifyAgents(instance, { project: emptyDir });
      expect(code).toBe(1);
    } finally {
      console.log = log;
    }
    const out = printed.join("\n");
    expect(out).toContain("no agents wired here");
  });

  it("fails on unknown agent specification", async () => {
    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await verifyAgents(instance, {}, "unknown-agent-xyz");
      expect(code).toBe(1);
    } finally {
      console.log = log;
    }
    const out = printed.join("\n");
    expect(out).toContain("unknown agent: unknown-agent-xyz");
  });

  it("verifies installed adapter hooks and skill", async () => {
    const wiredDir = await mkdtemp(join(tmpdir(), "memcell-wired-"));
    await claude.install(wiredDir);
    installSkill(wiredDir);

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const code = await verifyAgents(instance, { project: wiredDir });
      expect(code).toBe(0);
    } finally {
      console.log = log;
    }

    const out = printed.join("\n");
    expect(out).toContain("Claude Code");
    expect(out).toContain("7 of 7 events wired");
    expect(out).toContain("SessionStart");
    expect(out).toContain("Skill");
    expect(out).toContain("present & current");
  });

  it("outputs structured JSON when --json flag is provided", async () => {
    const wiredDir = await mkdtemp(join(tmpdir(), "memcell-wired-json-"));
    await claude.install(wiredDir);

    let captured = "";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      captured += String(chunk);
      return true;
    });

    try {
      const code = await verifyAgents(instance, { project: wiredDir, json: true }, "claude");
      expect(code).toBe(0);
    } finally {
      stdoutSpy.mockRestore();
    }

    const parsed = JSON.parse(captured.trim());
    expect(parsed.agents).toBeDefined();
    expect(parsed.agents[0].name).toBe("claude");
    expect(parsed.agents[0].wired).toBe(true);
    expect(parsed.agents[0].okEvents).toBe(7);
  });
});
