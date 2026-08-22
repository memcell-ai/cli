import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `memcell ingest <file>` — the connection is the credential. A wired
// directory holds a pair key that already names the instance and the space,
// so handing a document over asks for no login: the same standing the hooks
// act on every turn. What is pinned here is exactly that — the call rides
// the PAIR key with no credentials.json on the machine at all — plus the
// refusal in an unwired directory, which names connect, never login.

const home = await mkdtemp(join(tmpdir(), "memcell-ingest-home-"));
const project = await mkdtemp(join(tmpdir(), "memcell-ingest-proj-"));
const elsewhere = await mkdtemp(join(tmpdir(), "memcell-ingest-nowhere-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let answer: () => unknown = () => ({ created: [], reinforced: [] });

vi.stubGlobal(
  "fetch",
  async (url: string, init: { body?: string; headers: Record<string, string> }) => {
    calls.push({
      url,
      headers: init.headers,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    const body = answer();
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(body),
    };
  },
);

const { ingest } = await import("../src/commands/ingest.js");
const { saveAgentKey } = await import("../src/keyring.js");
const { saveProject } = await import("../src/project.js");

const doc = join(project, "NOTES.md");
const cwd = process.cwd;

beforeAll(async () => {
  await saveProject({ instance: "http://memcell.test", space: "api" }, project);
  await saveAgentKey({
    instance: "http://memcell.test",
    keyId: "key_1",
    key: "mc_pairkey",
    project,
  });
  await writeFile(doc, "The retry budget is three attempts with jitter.\n");
  return () => {
    process.cwd = cwd;
  };
});

beforeEach(() => {
  calls.length = 0;
});

describe("in a wired directory", () => {
  it("rides the pair key — no login session exists anywhere on this machine", async () => {
    process.cwd = () => project;
    answer = () => ({ created: [{ statementId: "s1" }], reinforced: [] });

    expect(await ingest(doc)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://memcell.test/api/v1/spaces/api/ingest");
    expect(calls[0]!.headers.authorization).toBe("Bearer mc_pairkey");
    expect(calls[0]!.body.raw).toContain("retry budget");
    expect((calls[0]!.body.origin as { title: string }).title).toBe("NOTES.md");
  });

  it("an honest zero is a result, not an error", async () => {
    process.cwd = () => project;
    answer = () => ({ created: [], reinforced: [], note: "Nothing durable in this." });
    expect(await ingest(doc)).toBe(0);
  });

  it("a file that cannot be read refuses without calling anything", async () => {
    process.cwd = () => project;
    expect(await ingest(join(project, "absent.md"))).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe("in an unwired directory", () => {
  it("refuses naming connect — never login", async () => {
    process.cwd = () => elsewhere;
    expect(await ingest(doc)).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
