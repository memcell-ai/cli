import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-orgs-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-orgs-dir-"));

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

const { listOrganizations, createOrganization, switchOrganization } =
  await import("../src/commands/orgs.js");
const { saveCredential } = await import("../src/instance.js");
const { get, set } = await import("../src/config.js");

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

describe("orgs list", () => {
  it("shows empty state when user belongs to no organizations", async () => {
    answer = () => ({ ok: true, organizations: [] });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listOrganizations(instance)).toBe(0);
    } finally {
      console.log = log;
    }

    const output = printed.join("\n");
    expect(output).toContain("no organizations");
    expect(output).toContain("memcell orgs create <slug> --name <name>");
  });

  it("lists organizations and marks the active context", async () => {
    await set("organization", "acme-corp", "global");

    answer = () => ({
      ok: true,
      organizations: [
        { id: "o1", slug: "acme-corp", name: "Acme Corporation", role: "owner" },
        { id: "o2", slug: "robotics", name: "Robotics AI Lab", role: "member" },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listOrganizations(instance)).toBe(0);
    } finally {
      console.log = log;
    }

    const output = printed.join("\n");
    expect(output).toContain("acme-corp");
    expect(output).toContain("Acme Corporation");
    expect(output).toContain("owner");
    expect(output).toContain("active");
    expect(output).toContain("robotics");
    expect(output).toContain("Robotics AI Lab");
    expect(output).toContain("member");
  });
});

describe("orgs create", () => {
  it("creates a new organization via POST /api/v1/organizations and sets active context", async () => {
    answer = () => ({
      ok: true,
      organization: { id: "o3", slug: "hyperion", name: "Hyperion Dynamics", role: "owner" },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await createOrganization(instance, "hyperion", { name: "Hyperion Dynamics" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/organizations");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ slug: "hyperion", name: "Hyperion Dynamics" });

    const active = (await get("organization"))?.value;
    expect(active).toBe("hyperion");

    const output = printed.join("\n");
    expect(output).toContain("Created organization");
    expect(output).toContain("hyperion");
    expect(output).toContain("Active context set");
  });
});

describe("orgs switch", () => {
  it("switches active organization context when member of org", async () => {
    answer = () => ({
      ok: true,
      organizations: [
        { id: "o1", slug: "acme-corp", name: "Acme Corporation", role: "owner" },
        { id: "o2", slug: "robotics", name: "Robotics AI Lab", role: "member" },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await switchOrganization(instance, "robotics")).toBe(0);
    } finally {
      console.log = log;
    }

    const active = (await get("organization"))?.value;
    expect(active).toBe("robotics");

    const output = printed.join("\n");
    expect(output).toContain("Active organization set to");
    expect(output).toContain("robotics");
  });

  it("switches to personal context when 'personal' is specified", async () => {
    await set("organization", "acme-corp", "global");

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await switchOrganization(instance, "personal")).toBe(0);
    } finally {
      console.log = log;
    }

    const active = (await get("organization"))?.value;
    expect(active).toBe("");

    const output = printed.join("\n");
    expect(output).toContain("Switched to personal context");
  });

  it("refuses to switch to unknown organization", async () => {
    answer = () => ({
      ok: true,
      organizations: [{ id: "o1", slug: "acme-corp", name: "Acme Corporation", role: "owner" }],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await switchOrganization(instance, "non-existent-org")).toBe(1);
    } finally {
      console.log = log;
    }

    const output = printed.join("\n");
    expect(output).toContain("unknown organization");
  });
});
