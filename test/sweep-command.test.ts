import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-sweep-home-"));
const projectDir = await mkdtemp(join(tmpdir(), "memcell-sweep-dir-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
let answer: (url: string, init?: any) => unknown = () => ({});

vi.stubGlobal(
  "fetch",
  async (
    url: string,
    init: { method?: string; body?: string; headers: Record<string, string> },
  ) => {
    calls.push({
      url,
      method: init?.method,
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    const ans = answer(url, init);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ans),
      json: async () => ans,
    };
  },
);

const { sweepConsolidate } = await import("../src/commands/sweep.js");
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

describe("sweep consolidate command", () => {
  it("submits a consolidation sweep with --no-wait", async () => {
    answer = (url) => {
      if (url.includes("/lifecycle/sweep/consolidate")) {
        return {
          jobId: "job_sweep_123",
          phases: [
            "clustering",
            "synthesizing",
            "fusing",
            "linking_edges",
            "surfacing_tensions",
            "refreshing_profile",
            "completed",
          ],
        };
      }
      return {};
    };

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const exitCode = await sweepConsolidate(instance, { "no-wait": true });
      expect(exitCode).toBe(0);
    } finally {
      console.log = log;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/v1/acme/research/lifecycle/sweep/consolidate");
    const out = printed.join("\n");
    expect(out).toContain("consolidation sweep");
    expect(out).toContain("job_sweep_123");
    expect(out).toContain("clustering");
  });

  it("submits a consolidation sweep with --no-wait and --json", async () => {
    answer = (url) => {
      if (url.includes("/lifecycle/sweep/consolidate")) {
        return {
          jobId: "job_sweep_456",
          phases: ["clustering", "completed"],
        };
      }
      return {};
    };

    const printed: string[] = [];
    const origWrite = process.stdout.write;
    (process.stdout as any).write = (chunk: string) => {
      printed.push(chunk);
      return true;
    };
    try {
      const exitCode = await sweepConsolidate(instance, { "no-wait": true, json: true });
      expect(exitCode).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(printed.join(""));
    expect(parsed.jobId).toBe("job_sweep_456");
    expect(parsed.status).toBe("accepted");
  });

  it("waits for completion and renders rich terminal output", async () => {
    answer = (url) => {
      if (url.includes("/lifecycle/sweep/consolidate")) {
        return {
          jobId: "job_sweep_789",
          phases: ["clustering", "synthesizing", "fusing", "completed"],
        };
      }
      if (url.includes("/api/v1/jobs/job_sweep_789")) {
        return {
          ok: true,
          job: {
            id: "job_sweep_789",
            step: "completed",
            progress: 100,
            message: "Sweep completed: 3 fusions, 5 relations, 1 tensions surfaced.",
            result: {
              examinedCount: 42,
              clusterCount: 4,
              fusionsCount: 3,
              fusedStatementIds: ["stmt_a", "stmt_b"],
              canonicalStatementIds: ["stmt_canon_1"],
              relationsCount: 5,
              createdRelations: [
                { sourceId: "stmt_1", targetId: "stmt_2", relationType: "depends_on" },
              ],
              tensionsCount: 1,
              contestedStatementIds: ["stmt_contested"],
              profileUpdated: true,
              durationMs: 3450,
            },
          },
        };
      }
      return {};
    };

    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      const exitCode = await sweepConsolidate(instance, {});
      expect(exitCode).toBe(0);
    } finally {
      console.log = log;
    }

    const out = printed.join("\n");
    expect(out).toContain("sweep complete");
    expect(out).toContain("examined");
    expect(out).toContain("42");
    expect(out).toContain("clusters");
    expect(out).toContain("fusions");
    expect(out).toContain("relations");
    expect(out).toContain("tensions");
    expect(out).toContain("profile regenerated");
    expect(out).toContain("tension(s) surfaced for human review");
  });

  it("passes customization parameters (similarity, cluster sizes) to SDK", async () => {
    answer = (url) => {
      if (url.includes("/lifecycle/sweep/consolidate")) {
        return {
          jobId: "job_sweep_opts",
          phases: ["clustering", "completed"],
        };
      }
      return {};
    };

    await sweepConsolidate(instance, {
      "no-wait": true,
      "min-similarity": "0.88",
      "min-cluster-size": "3",
      "max-cluster-size": "6",
    });

    expect(calls[0]!.body).toEqual({
      minSimilarity: 0.88,
      minClusterSize: 3,
      maxClusterSize: 6,
    });
  });
});
