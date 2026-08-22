import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The three legs of the loop, from a shell. `ingest` could always be run
// this way; recall, remember and report could not, so an agent with no MCP
// tools — a skill installed on its own, a harness without MCP, a script in
// CI — could not use memory at all. What is pinned here is that each leg
// rides the directory's own pair key to the door the MCP tool calls, and
// that the ids recall prints are the ids report takes.

const home = await mkdtemp(join(tmpdir(), "memcell-loop-home-"));
const project = await mkdtemp(join(tmpdir(), "memcell-loop-proj-"));
const elsewhere = await mkdtemp(join(tmpdir(), "memcell-loop-nowhere-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let answer: () => unknown = () => ({});

vi.stubGlobal(
  "fetch",
  async (url: string, init: { body?: string; headers: Record<string, string> }) => {
    calls.push({
      url,
      headers: init.headers,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return { ok: true, status: 200, text: async () => JSON.stringify(answer()) };
  },
);

const { recall } = await import("../src/commands/recall.js");
const { remember } = await import("../src/commands/remember.js");
const { report } = await import("../src/commands/report.js");
const { saveAgentKey } = await import("../src/keyring.js");
const { saveProject } = await import("../src/project.js");

const cwd = process.cwd;

beforeAll(async () => {
  await saveProject({ instance: "http://memcell.test", space: "api" }, project);
  await saveAgentKey({
    instance: "http://memcell.test",
    keyId: "key_1",
    key: "mc_pairkey",
    project,
  });
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
  process.cwd = () => project;
});

describe("recall", () => {
  it("asks the same door the hooks ask, on the pair key", async () => {
    answer = () => ({
      momentId: "m1",
      results: [
        {
          statementId: "s1",
          text: "Retries cap at five attempts.",
          kind: "convention",
          confidence: 0.72,
          layer: "team",
          vouched: true,
        },
      ],
    });

    expect(await recall("how do retries behave?")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/recall");
    expect(calls[0]!.headers.authorization).toBe("Bearer mc_pairkey");
    expect(calls[0]!.body.intent).toBe("how do retries behave?");
  });

  it("carries a limit only when one is given, and only when it is a number", async () => {
    answer = () => ({ momentId: "m1", results: [] });

    await recall("anything", "3");
    expect(calls[0]!.body.limit).toBe(3);

    calls.length = 0;
    await recall("anything", "lots");
    expect(calls[0]!.body).not.toHaveProperty("limit");

    calls.length = 0;
    await recall("anything");
    expect(calls[0]!.body).not.toHaveProperty("limit");
  });

  it("marks a pinned statement, so presence is never read as relevance", async () => {
    answer = () => ({
      momentId: "m1",
      results: [
        {
          statementId: "s1",
          text: "Matched this question.",
          kind: null,
          confidence: 0.7,
          layer: "team",
          vouched: true,
        },
        {
          statementId: "s2",
          text: "Standing rule, here whatever you asked.",
          kind: "convention",
          confidence: 0.8,
          layer: "team",
          vouched: true,
          pinned: true,
        },
      ],
    });
    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await recall("anything")).toBe(0);
    } finally {
      console.log = log;
    }
    const out = printed.join("\n");
    expect(out).toContain("pinned");
    // Only the pin carries it — the matched statement must not.
    expect(out.split("Matched this question.")[0]).not.toContain("pinned");
  });

  it("an empty answer is a result, not a failure", async () => {
    answer = () => ({ momentId: "m1", results: [] });
    expect(await recall("nothing known about this")).toBe(0);
  });
});

describe("remember", () => {
  it("files one claim at the statements door", async () => {
    answer = () => ({ id: "s9", scope: "team", confidence: 0.55, note: "Filed at 0.55." });

    expect(await remember("Retries cap at five attempts.")).toBe(0);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/spaces/api/statements");
    expect(calls[0]!.headers.authorization).toBe("Bearer mc_pairkey");
    expect(calls[0]!.body.text).toBe("Retries cap at five attempts.");
    expect(calls[0]!.body).not.toHaveProperty("kind");
  });

  it("carries a kind when one is named", async () => {
    answer = () => ({ id: "s9", scope: "team", confidence: 0.55, note: "Filed." });
    await remember("Never call the gateway from a migration.", "convention");
    expect(calls[0]!.body.kind).toBe("convention");
  });
});

describe("report", () => {
  it("posts the outcome against the statement recall named", async () => {
    answer = () => ({ from: 0.55, to: 0.62 });

    expect(await report("s1", "worked")).toBe(0);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/spaces/api/statements/s1/outcomes");
    expect(calls[0]!.body.outcome).toBe("worked");
    expect(calls[0]!.body).not.toHaveProperty("note");
  });

  it("carries a note when one is given", async () => {
    answer = () => ({ from: 0.55, to: 0.48 });
    await report("s1", "failed", "the cap did not hold under load");
    expect(calls[0]!.body.note).toBe("the cap did not hold under load");
  });

  it("refuses an outcome the record has no meaning for, before any call", async () => {
    // The vocabulary is the engine's, and a typo must not reach the door as
    // a silent no-op.
    expect(await report("s1", "maybe")).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("takes the id recall prints, unencoded on the way out", async () => {
    answer = () => ({ from: 0.5, to: 0.6 });
    await report("7f3e-with/slash", "worked");
    expect(calls[0]!.url).toContain("statements/7f3e-with%2Fslash/outcomes");
  });
});

describe("outside a wired directory", () => {
  it("every leg refuses the same way, and names connect", async () => {
    process.cwd = () => elsewhere;
    for (const leg of [
      () => recall("anything"),
      () => remember("anything"),
      () => report("s1", "worked"),
    ]) {
      expect(await leg()).toBe(1);
    }
    expect(calls).toHaveLength(0);
  });
});
