import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The loop, as the hooks fire it. What is pinned is which leg runs at which
// moment, and the two rules that keep a hook safe to install in somebody's
// session: it fails open on every path, and it never judges — it reports an
// outcome only where the memory itself said the material corroborated a
// statement a recall had served.

const home = await mkdtemp(join(tmpdir(), "memcell-hook-home-"));
const project = await mkdtemp(join(tmpdir(), "memcell-hook-proj-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}[] = [];
let answer: (path: string) => unknown = () => ({});

vi.stubGlobal(
  "fetch",
  async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const path = new URL(url).pathname.replace("/api/v1/", "");
    calls.push({
      path,
      body: JSON.parse(init.body) as Record<string, unknown>,
      headers: init.headers,
    });
    const body = answer(path);
    if (body === null) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  },
);

const { runMoment } = await import("../src/loop/hook.js");
const { LEGS } = await import("../src/loop/moments.js");
const { saveAgentKey } = await import("../src/keyring.js");
const { saveProject } = await import("../src/project.js");

const transcript = join(project, "t.jsonl");

beforeAll(async () => {
  await saveProject({ instance: "http://memcell.test", space: "api" }, project);
  await saveAgentKey({
    instance: "http://memcell.test",
    keyId: "key_1",
    key: "mc_ktest",
    project,
  });
  await mkdir(join(home, ".memcell"), { recursive: true });
  await writeFile(
    transcript,
    [
      JSON.stringify({ message: { role: "user", content: "how do we handle money?" } }),
      JSON.stringify({
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Amounts are integer cents." },
            // What the turn WROTE, as the transcript records it: the names
            // ride the hand-over; the reads and the contents never do.
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: `${project}/src/money.ts` },
            },
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: `${project}/src/money.test.ts` },
            },
            { type: "tool_use", name: "Read", input: { file_path: `${project}/README.md` } },
          ],
        },
      }),
    ].join("\n"),
  );
});

/** stdin as an agent hands it over. */
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

const reset = () => {
  calls.length = 0;
  answer = () => ({});
};

describe("which leg runs when", () => {
  it("recalls before the agent acts, and only then", () => {
    expect(LEGS["session-start"]).toEqual(["recall"]);
    expect(LEGS["prompt-submit"]).toEqual(["recall"]);
    // Remembering at prompt-submit would hand over a turn that has not
    // happened; reporting there would report on nothing.
    expect(LEGS["turn-end"]).toEqual(["remember", "report"]);
    expect(LEGS["session-end"]).toEqual(["remember", "report"]);
  });
});

describe("recall", () => {
  it("asks the prompt at prompt-submit and injects what comes back", async () => {
    reset();
    answer = () => ({
      momentId: "m1",
      results: [{ statementId: "s1", text: "Amounts are cents.", confidence: 0.8, layer: "team" }],
    });
    fed({ session_id: "r1", cwd: project, prompt: "how do we handle money?" });

    const out = await runMoment("prompt-submit", "claude");
    expect(calls[0]!.path).toBe("recall");
    expect(calls[0]!.body.intent).toBe("how do we handle money?");
    expect(out.context).toContain("Amounts are cents.");
    // The confidence rides along: a statement stripped of it invites
    // treating a guess as a fact.
    expect(out.context).toContain("0.80");
  });

  it("leads with what this session has already gone against", async () => {
    // The correction only works if the agent reads it. Buried fifteenth in a
    // list it is one more fact; the session has already demonstrated that is
    // not enough, which is the whole reason it is being said twice.
    reset();
    answer = () => ({
      momentId: "m2",
      results: [
        { statementId: "s1", text: "Amounts are cents.", confidence: 0.8, layer: "team" },
        {
          statementId: "s2",
          text: "Never call the gateway from a migration.",
          confidence: 0.7,
          layer: "team",
          diverged: true,
        },
      ],
    });
    fed({ session_id: "r9", cwd: project, prompt: "add the migration" });

    const out = await runMoment("prompt-submit", "claude");
    const context = out.context ?? "";
    expect(context).toContain("already gone against these this session");
    // It leads: the warning comes before the ordinary recall heading.
    expect(context.indexOf("Never call the gateway from a migration.")).toBeLessThan(
      context.indexOf("From this project's memory"),
    );
    // And it is not repeated below as an ordinary statement.
    expect(context.split("Never call the gateway from a migration.")).toHaveLength(2);
    // Everything else still arrives, in its own section.
    expect(context).toContain("Amounts are cents.");
  });

  it("says nothing about divergence when there is none", async () => {
    reset();
    answer = () => ({
      momentId: "m3",
      results: [{ statementId: "s1", text: "Amounts are cents.", confidence: 0.8, layer: "team" }],
    });
    fed({ session_id: "r10", cwd: project, prompt: "how do we handle money?" });

    const out = await runMoment("prompt-submit", "claude");
    expect(out.context).not.toContain("gone against");
  });

  it("asks about the work itself at session start, where there is no prompt yet", async () => {
    reset();
    answer = () => ({ momentId: "m2", results: [] });
    fed({ session_id: "r2", cwd: project });

    await runMoment("session-start", "claude");
    expect(calls[0]!.path).toBe("recall");
    expect(String(calls[0]!.body.intent)).toContain("api");
  });

  it("says nothing when memory has nothing — silence, not noise in the turn", async () => {
    reset();
    answer = () => ({ momentId: "m3", results: [], note: "This memory is empty." });
    fed({ session_id: "r3", cwd: project, prompt: "anything" });

    const out = await runMoment("prompt-submit", "claude");
    // Even with something to say. Somebody is watching the cursor here, and
    // the same sentence on every prompt is noise rather than help.
    expect(out.context).toBeUndefined();
  });

  it("passes the memory's own words on once, at the start, when it found nothing", async () => {
    // An empty recall and a broken hook look identical from inside a
    // session, and an agent told nothing concludes the wiring is wrong.
    // What the emptiness MEANS is memcell's to say, so the hook carries the
    // sentence rather than composing one.
    reset();
    answer = () => ({
      momentId: "m4",
      results: [],
      note: "This memory is empty — nothing has been filed here yet.",
    });
    fed({ session_id: "r4", cwd: project });

    const out = await runMoment("session-start", "claude");
    expect(out.context).toBe("This memory is empty — nothing has been filed here yet.");
  });

  it("carries what the memory said into the log, so a quiet firing is readable", async () => {
    reset();
    answer = () => ({ momentId: "m5", results: [], note: "Nothing here answers that." });
    fed({ session_id: "r5", cwd: project, prompt: "anything" });

    await runMoment("prompt-submit", "claude");
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("Nothing here answers that.");
  });
});

describe("remember, and the report it justifies", () => {
  // The turn's name is the session plus the read offset, so an offset that
  // stands still names the next turn identically to this one and the
  // instance stands the delivery down as already handed over — forever. A
  // reader that returns material without advancing is therefore held back
  // here, at the seam where the name is made, rather than trusted.
  it("holds back material that arrived without the offset advancing", async () => {
    reset();
    answer = () => ({ created: [], reinforced: [], attributed: [] });

    // A reader that hands over text and leaves the offset exactly where it
    // found it — the shape that wedged every session on the machine.
    const capture = await import("../src/adapters/capture.js");
    const stuck = vi
      .spyOn(capture, "readJsonlSlice")
      .mockImplementation(async (_path, from, onEntry) => {
        onEntry({
          type: "assistant",
          message: { role: "assistant", content: "A decision worth keeping, at length." },
        });
        return from;
      });

    fed({ session_id: "stuck", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    stuck.mockRestore();

    // Nothing was handed over, so nothing can be named twice.
    expect(calls.find((c) => c.path.endsWith("/ingest"))).toBeUndefined();
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("without advancing");
  });

  it("hands the turn's material over, and reports back what the engine attributed", async () => {
    reset();
    answer = (path) =>
      path === "recall"
        ? {
            momentId: "m9",
            results: [{ statementId: "s9", text: "Cents.", confidence: 0.5, layer: "me" }],
          }
        : path.endsWith("/ingest")
          ? {
              created: [],
              reinforced: [{ statementId: "s9" }],
              attributed: [{ statementId: "s9", outcome: "worked" }],
            }
          : {};

    fed({ session_id: "loop", cwd: project, prompt: "money?" });
    await runMoment("prompt-submit", "claude");

    reset();
    answer = (path) =>
      path.endsWith("/ingest")
        ? {
            created: [],
            reinforced: [{ statementId: "s9" }],
            attributed: [{ statementId: "s9", outcome: "worked" }],
          }
        : {};
    fed({ session_id: "loop", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");

    const ingest = calls.find((c) => c.path.endsWith("/ingest"));
    expect(String(ingest!.body.raw)).toContain("integer cents");
    // The files the turn wrote ride the hand-over by NAME, relative to the
    // project — and only the writes: the Read of README.md does not travel.
    expect(ingest!.body.touched).toEqual(["src/money.ts", "src/money.test.ts"]);
    expect(String(ingest!.body.raw)).not.toContain("README");

    // THE HOOK IS A PIPE: it never posts an outcome of its own. The engine
    // judged and the ingest response carried the credit; the hook only reports
    // what came back.
    expect(calls.find((c) => c.path.includes("/outcomes"))).toBeUndefined();
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("report · 1 worked");
  });

  it("posts no outcome of its own — attribution is the engine's, not the hook's", async () => {
    reset();
    answer = (path) =>
      path.endsWith("/ingest")
        ? { created: [], reinforced: [{ statementId: "stranger" }], attributed: [] }
        : {};
    fed({ session_id: "solo", cwd: project, transcript_path: transcript });

    await runMoment("turn-end", "claude");
    expect(calls.find((c) => c.path.includes("/outcomes"))).toBeUndefined();
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("nothing the session bore on");
  });

  it("hands over nothing when the transcript has not moved", async () => {
    reset();
    answer = () => ({ created: [], reinforced: [] });
    fed({ session_id: "again", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    const first = calls.filter((c) => c.path.endsWith("/ingest")).length;

    reset();
    fed({ session_id: "again", cwd: project, transcript_path: transcript });
    await runMoment("turn-end", "claude");
    // The second firing has nothing new: a turn ships what is new, never the
    // whole conversation again.
    expect(calls.filter((c) => c.path.endsWith("/ingest"))).toHaveLength(0);
    expect(first).toBe(1);
  });
});

describe("the working session", () => {
  it("puts the same session on every leg it fires, so the record can group them", async () => {
    reset();
    answer = (path) =>
      path === "recall"
        ? {
            momentId: "m9",
            results: [{ statementId: "s9", text: "x", confidence: 0.8, layer: "team" }],
          }
        : { created: [], reinforced: [{ statementId: "s9" }], attributed: [] };
    await writeFile(
      transcript,
      JSON.stringify({
        message: { role: "assistant", content: "The pooler drops advisory locks." },
      }),
    );
    fed({ session_id: "sess-real", cwd: project, transcript_path: transcript });

    await runMoment("session-start", "claude");
    await runMoment("turn-end", "claude");

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c.headers["x-memcell-session"] === "sess-real")).toBe(true);
  });

  it("sends no session at all where the harness gave none", async () => {
    // "unknown" on the wire would read back as one long session containing
    // every unidentified firing on the machine — a fiction the record cannot
    // tell from a fact.
    reset();
    answer = () => ({ momentId: "m10", results: [] });
    fed({ cwd: project, prompt: "anything" });

    await runMoment("prompt-submit", "claude");
    expect(calls[0]!.headers["x-memcell-session"]).toBeUndefined();
  });
});

describe("failing open", () => {
  it("says nothing and does not throw when every door refuses", async () => {
    reset();
    answer = () => null;
    fed({ session_id: "down", cwd: project, prompt: "anything" });
    await expect(runMoment("prompt-submit", "claude")).resolves.toMatchObject({});
  });

  it("sends its deadline and the turn's name with the call", async () => {
    // The budget rides every call — the instance works TO the caller's
    // deadline instead of being cut off by it. The turn's name rides the
    // hand-over, fixed before the read moves the offset, so a retried
    // delivery of this turn carries the same name.
    reset();
    answer = (path) =>
      path === "recall"
        ? { momentId: "m-b", results: [] }
        : { created: [], reinforced: [], attributed: [] };
    fed({ session_id: "s-budget", cwd: project, prompt: "anything", transcript_path: transcript });
    await runMoment("prompt-submit", "claude");
    await runMoment("turn-end", "claude");

    const recall = calls.find((c) => c.path === "recall");
    expect(Number(recall!.headers["x-memcell-budget"])).toBeGreaterThanOrEqual(8_000);
    const ingest = calls.find((c) => c.path.endsWith("/ingest"));
    expect(Number(ingest!.headers["x-memcell-budget"])).toBeGreaterThan(0);
    expect(ingest!.headers["x-memcell-turn"]).toMatch(/^s-budget:/);
  });

  it("retries once on a network failure, with the same turn name", async () => {
    // A refusal is an answer and is never retried; a network failure is
    // not, and gets exactly one more try. The turn's name is what makes
    // the retry safe: a delivery whose response was lost lands once.
    reset();
    let drops = 1;
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      if (String(url).endsWith("/ingest") && drops-- > 0) throw new TypeError("socket hangup");
      return (real as (u: unknown, i: unknown) => unknown)(url, init);
    }) as typeof fetch;
    try {
      answer = (path) =>
        path === "recall"
          ? { momentId: "m-r", results: [] }
          : { created: [{ statementId: "st1" }], reinforced: [], attributed: [] };
      fed({ session_id: "s-retry", cwd: project, prompt: "x", transcript_path: transcript });
      await runMoment("turn-end", "claude");
    } finally {
      globalThis.fetch = real;
    }

    const deliveries = calls.filter((c) => c.path.endsWith("/ingest"));
    expect(deliveries).toHaveLength(1); // the drop never reached the recorder
    // The tag carries the agent, not the session, so anchor on the last
    // remember line — the one this turn wrote after its retry.
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    const tail = log.slice(log.lastIndexOf(" remember "));
    expect(tail).toContain("1 kept");
    expect(tail).not.toContain("could not be reached");
  });

  it("logs a refusal as a refusal, never as an honest zero", async () => {
    // The first full run against a misconfigured instance logged
    // "0 served" and "0 kept, 0 reinforced" for a whole session while the
    // server errored on every call. The agent side stays silent — fail
    // open — but the log is where an operator reads why nothing landed,
    // and there a refusal and an empty judgment are different facts.
    reset();
    answer = () => null;
    fed({ session_id: "down-2", cwd: project, prompt: "anything", transcript_path: transcript });
    await runMoment("prompt-submit", "claude");
    await runMoment("turn-end", "claude");

    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    const today = log.slice(log.indexOf("down-2") - 200);
    expect(today).toContain("answered 503");
    expect(today).toContain("this turn was not captured");
    expect(today).toContain("not asked");
    expect(today).not.toContain("0 served");
    expect(today).not.toContain("0 kept");
  });

  it("says the link is there but the key is gone, which is a different problem", async () => {
    // The first real session the hooks ever ran in logged "not linked here"
    // three times while the `.memcell` file sat in the directory. The link
    // was fine; the machine had forgotten the key — after a reset — and the
    // message sent somebody to check the one thing that was not wrong.
    reset();
    const { forgetAgentKey } = await import("../src/keyring.js");
    await forgetAgentKey("http://memcell.test", "key_1");
    fed({ session_id: "gone", cwd: project, prompt: "anything" });

    const out = await runMoment("prompt-submit", "claude");
    expect(out.context).toBeUndefined();
    expect(calls).toHaveLength(0);

    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("no key for");
    expect(log).toContain("memcell connect");

    // Put it back for whatever runs after this.
    await saveAgentKey({
      instance: "http://memcell.test",
      keyId: "key_1",
      key: "mc_ktest",
      project,
    });
  });

  it("does nothing at all where the directory is not linked", async () => {
    reset();
    const elsewhere = await mkdtemp(join(tmpdir(), "memcell-unlinked-"));
    fed({ session_id: "nowhere", cwd: elsewhere, prompt: "anything" });
    const out = await runMoment("prompt-submit", "claude");
    expect(calls).toHaveLength(0);
    expect(out.context).toBeUndefined();
  });

  it("writes a line whichever way it went, so 'fired and found nothing' is tellable from 'never fired'", async () => {
    const log = await readFile(join(home, ".memcell", "hook.log"), "utf8");
    expect(log).toContain("recall · 0 served");
    expect(log).toContain("not wired");
  });
});

describe("the wired invocation is portable", () => {
  // A wiring is written on one machine and read on others, so it names
  // `memcell` and nothing else — no interpreter path, no entry path, no
  // agent id. That makes it committable, and it survives a version manager
  // moving the interpreter out from under it.
  //
  // What this costs is written down because it was paid once already: on
  // Windows, agents run hooks through a bash that does not share npm's
  // PATH, and a bare `memcell` wired fine and then failed on every session
  // start. Absolute paths bought that back and cost portability. So the
  // bare word is the contract and `connect` earns it — it asks whether a
  // hook's shell can resolve `memcell` and says plainly when it cannot,
  // which turns a silent forever-failure into one sentence at wiring time.
  const held = { argv: process.argv, execPath: process.execPath };
  afterEach(() => {
    process.argv = held.argv;
    Object.defineProperty(process, "execPath", { value: held.execPath });
  });

  it("names the bare word, whatever interpreter and entry are running", async () => {
    const { hookCommand } = await import("../src/loop/moments.js");
    process.argv = [
      held.execPath,
      "C:\\Users\\ahmer iqbal\\AppData\\Roaming\\npm\\node_modules\\memcell\\dist\\index.js",
    ];
    Object.defineProperty(process, "execPath", { value: "C:\\Program Files\\nodejs\\node.exe" });
    expect(hookCommand("session-start", "claude")).toBe("memcell hook session-start claude");
  });

  it("a throwaway npx run wires the same word, never its cache", async () => {
    const { hookCommand, hookMatches } = await import("../src/loop/moments.js");
    process.argv = [held.execPath, "/Users/x/.npm/_npx/abc123/node_modules/memcell/dist/index.js"];
    const command = hookCommand("prompt-submit", "claude");
    expect(command).toBe("memcell hook prompt-submit claude");
    // Every older form is still recognised as ours, so a re-install
    // replaces one rather than wiring a second beside it.
    expect(hookMatches(command, "prompt-submit", "claude")).toBe(true);
    expect(
      hookMatches("memcell hook prompt-submit claude --agent old", "prompt-submit", "claude"),
    ).toBe(true);
    expect(
      hookMatches(
        '"/usr/bin/node" "/x/memcell" hook prompt-submit claude',
        "prompt-submit",
        "claude",
      ),
    ).toBe(true);
  });

  it("connect can tell whether a hook's shell will find it", async () => {
    // The mitigation the bare word depends on. Without this question being
    // asked out loud, an unresolvable `memcell` is a loop that does nothing
    // and says nothing.
    const { memcellOnPath } = await import("../src/adapters/shared.js");
    expect(typeof (await memcellOnPath())).toBe("boolean");
  });
});
