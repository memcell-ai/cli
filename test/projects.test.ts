import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-projects-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-projects-dir-"));

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

const { listProjects, newProject, useProject } = await import("../src/commands/projects.js");
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
  await saveProject({ instance, project: "core", space: "core" }, projectDir);
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  process.cwd = () => projectDir;
});

describe("projects ls", () => {
  it("lists projects and marks active and linked", async () => {
    answer = () => ({
      activeProject: { slug: "core", name: "Core Engine" },
      projects: [
        { id: "p1", slug: "core", name: "Core Engine" },
        { id: "p2", slug: "docs", name: "Documentation" },
      ],
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await listProjects(instance)).toBe(0);
    } finally {
      console.log = log;
    }

    const output = printed.join("\n");
    expect(output).toContain("core");
    expect(output).toContain("docs");
    expect(output).toContain("active");
    expect(output).toContain("linked here");
  });
});

describe("projects new", () => {
  it("creates a new project via POST /api/v1/projects", async () => {
    answer = () => ({ id: "p3", slug: "analytics", name: "Analytics" });

    expect(await newProject(instance, "Analytics")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/projects");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ name: "Analytics" });
  });

  it("creates a new project under active organization context when configured", async () => {
    const { set } = await import("../src/config.js");
    await set("organization", "acme-corp", "global");

    answer = () => ({ id: "p4", slug: "checkout", name: "Checkout Service" });

    expect(await newProject(instance, "Checkout Service")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/projects");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ name: "Checkout Service", owner: "acme-corp" });

    await set("organization", "", "global");
  });

  it("handles wrapped project responses gracefully", async () => {
    answer = () => ({
      ok: true,
      project: { id: "p5", slug: "wrapped-proj", name: "Wrapped Project", ownerSlug: "org" },
    });

    expect(await newProject(instance, "Wrapped Project")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/projects");
  });
});

describe("projects use", () => {
  it("switches active project via PATCH /api/v1/me", async () => {
    answer = () => ({ activeProject: { slug: "analytics", name: "Analytics" } });

    expect(await useProject(instance, "analytics")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/me");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ project: "analytics" });
  });
});
