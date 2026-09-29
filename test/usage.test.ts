import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-usage-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-usage-dir-"));

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

const { getUsage } = await import("../src/commands/usage.js");
const { saveCredential } = await import("../src/instance.js");
const { set } = await import("../src/config.js");

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

describe("usage get", () => {
  it("fetches resource usage for explicit owner", async () => {
    answer = () => ({
      owner: { slug: "acme", type: "organization" },
      timeframe: "30d",
      quotas: {
        statements: {
          total: 1250,
          limit: 10000,
          types: { directive: 800, preference: 450 },
        },
        apiRequests: {
          total: 35000,
          limit: 100000,
        },
      },
      rateLimits: {
        tier: "growth",
        recallRpm: 1200,
        rememberRpm: 600,
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await getUsage(instance, "acme", { timeframe: "30d" })).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/acme/usage?timeframe=30d");
    const out = printed.join("\n");
    expect(out).toContain("usage");
    expect(out).toContain("acme");
    expect(out).toContain("statements:");
    expect(out).toContain("1,250");
    expect(out).toContain("10,000");
    expect(out).toContain("tier:");
    expect(out).toContain("growth");
  });

  it("fetches resource usage using active organization context", async () => {
    await set("organization", "cyberdyne", "global");

    answer = () => ({
      owner: { slug: "cyberdyne", type: "organization" },
      quotas: {
        statements: { total: 50, limit: 1000 },
        apiRequests: { total: 200, limit: 5000 },
      },
    });

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await getUsage(instance)).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/cyberdyne/usage");
    const out = printed.join("\n");
    expect(out).toContain("cyberdyne");
  });
});
