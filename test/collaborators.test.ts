import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-collab-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-collab-dir-"));

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
  listCollaborators,
  inviteCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  revokeCollaboratorInvite,
} = await import("../src/commands/collaborators.js");
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

describe("collaborators list", () => {
  it("lists collaborators and pending invitations", async () => {
    answer = () => ({
      collaborators: [
        {
          userId: "usr_alice",
          name: "Alice Engineer",
          email: "alice@example.com",
          role: "admin",
        },
      ],
      pendingInvitations: [
        {
          id: "inv_bob",
          email: "bob@example.com",
          role: "write",
        },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listCollaborators(instance, undefined, {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/collaborators");
    const out = printed.join("\n");
    expect(out).toContain("Alice Engineer");
    expect(out).toContain("admin");
    expect(out).toContain("bob@example.com");
  });
});

describe("collaborators invite", () => {
  it("invites a user by email with specific role", async () => {
    answer = () => ({
      invitation: {
        id: "inv_carol",
        email: "carol@example.com",
        role: "write",
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await inviteCollaborator(instance, "carol@example.com", { role: "write" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/collaborators");
    expect(calls[0]!.body).toEqual({ identifier: "carol@example.com", role: "write" });
    const out = printed.join("\n");
    expect(out).toContain("invited");
    expect(out).toContain("carol@example.com");
    expect(out).toContain("write");
  });
});

describe("collaborators update-role", () => {
  it("updates collaborator role", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await updateCollaboratorRole(instance, "usr_alice", { role: "read" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/collaborators/usr_alice");
    expect(calls[0]!.body).toEqual({ role: "read" });
    const out = printed.join("\n");
    expect(out).toContain("updated role");
    expect(out).toContain("read");
  });
});

describe("collaborators remove", () => {
  it("removes a collaborator from the project", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await removeCollaborator(instance, "usr_alice", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/research/collaborators/usr_alice");
    const out = printed.join("\n");
    expect(out).toContain("removed");
    expect(out).toContain("usr_alice");
  });
});

describe("collaborators revoke-invite", () => {
  it("revokes a pending invitation", async () => {
    answer = () => ({ ok: true });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await revokeCollaboratorInvite(instance, "inv_bob", {})).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(
      "http://memcell.test/api/v1/acme/research/collaborators/invitations/inv_bob",
    );
    const out = printed.join("\n");
    expect(out).toContain("revoked invitation");
    expect(out).toContain("inv_bob");
  });
});
