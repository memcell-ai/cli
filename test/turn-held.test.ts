import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A turn the instance did not take must be offered again.
//
// The reader advances an offset as it consumes a transcript, and the offset
// used to advance whether or not the delivery landed. An instance that
// refused — 503, a deploy, a suspended tenant — left that turn's work behind
// a marker that had already moved past it, so it was never read again and
// nobody was told. Silent loss, which is the shape of the capture bug that
// wedged this loop for two days, running the other way.
//
// Re-delivery is safe by construction: the turn's NAME is derived from the
// offset it started at, so an instance that did land it sees a name it has
// already seen and stands the repeat down.

const home = await mkdtemp(join(tmpdir(), "memcell-held-home-"));
const project = await mkdtemp(join(tmpdir(), "memcell-held-proj-"));
const transcript = join(project, "t.jsonl");

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
  [];
let refuseIngest = false;

vi.stubGlobal(
  "fetch",
  async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const path = new URL(url).pathname.replace("/api/v1/", "");
    calls.push({
      path,
      body: JSON.parse(init.body) as Record<string, unknown>,
      headers: init.headers,
    });
    if (path.includes("ingest") && refuseIngest) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (path.includes("ingest")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ created: [], reinforced: [], attributed: [] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ momentId: "m", results: [] }) };
  },
);

const { runMoment } = await import("../src/loop/hook.js");
const { saveAgentKey } = await import("../src/keyring.js");
const { saveProject } = await import("../src/project.js");

function fed(payload: unknown) {
  const chunks = [Buffer.from(JSON.stringify(payload))];
  Object.defineProperty(process, "stdin", {
    value: Object.assign({
      isTTY: false,
      [Symbol.asyncIterator]: async function* () {
        yield* chunks;
      },
    }),
    configurable: true,
  });
}

beforeAll(async () => {
  await saveProject({ instance: "http://memcell.test", space: "api" }, project);
  await saveAgentKey({
    instance: "http://memcell.test",
    keyId: "key_1",
    key: "mc_ktest",
    project,
  });
  await mkdir(join(home, ".memcell"), { recursive: true });
  await writeFile(transcript, "");
});

describe("a delivery the instance refused", () => {
  it("holds the turn, and the next firing offers the same material under the same name", async () => {
    await appendFile(
      transcript,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Retries cap at five attempts, in this project." },
      })}\n`,
    );

    refuseIngest = true;
    fed({ session_id: "held", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    const first = calls.find((c) => c.path.includes("ingest"));
    expect(String(first?.body.raw ?? "")).toContain("Retries cap at five attempts");

    calls.length = 0;
    refuseIngest = false;
    fed({ session_id: "held", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");

    const again = calls.find((c) => c.path.includes("ingest"));
    expect(String(again?.body.raw ?? ""), "the refused turn was never offered again").toContain(
      "Retries cap at five attempts",
    );
    // Same name, so an instance that did land it can refuse the duplicate.
    expect(again?.headers["x-memcell-turn"]).toBe(first?.headers["x-memcell-turn"]);
  });

  it("does not re-offer a turn that landed", async () => {
    calls.length = 0;
    await appendFile(
      transcript,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "A second turn, which the instance accepts." },
      })}\n`,
    );
    fed({ session_id: "held", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    expect(String(calls.find((c) => c.path.includes("ingest"))?.body.raw ?? "")).toContain(
      "A second turn",
    );

    // Nothing new since; the offset stands where the landed turn left it.
    calls.length = 0;
    fed({ session_id: "held", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    expect(calls.some((c) => c.path.includes("ingest"))).toBe(false);
  });
});
