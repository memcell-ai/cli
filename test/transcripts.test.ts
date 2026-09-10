import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { adapterFor } = await import("../src/adapters/index.js");
const { cleanUserPrompt, readIntentEnvelope } = await import("../src/adapters/capture.js");
const { isGuard, asContext } = await import("../src/loop/hook.js");

const readSession = (program: string, payload: Record<string, unknown>, from: number) => {
  const adapter = adapterFor(program);
  return adapter
    ? adapter.read(payload, from)
    : Promise.resolve({ text: "", touched: [], read: from });
};

// The remember leg reads a session back in the agent's OWN dialect — the
// mirror of the injection dialect. memcell is not a Claude tool: every
// supported agent's record must yield the two things the leg needs — the
// turn's prose and the NAMES of the files it wrote — and never a byte of
// their contents. These prove each reader against that agent's real shape,
// with the Codex case running over a rollout an actual `codex exec` wrote.

const FIXTURES = fileURLToPath(new URL("./fixtures/transcripts/", import.meta.url));

let root = "";
const proj = "/work/project";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "memcell-transcripts-"));
});

afterAll(async () => {
  // The temp dirs are throwaway; nothing here writes outside them.
});

describe("reading a session in each agent's dialect", () => {
  it("claude — prose from message blocks, writes from Edit/Write tool_use, reads ignored", async () => {
    const path = join(root, "claude.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ message: { role: "user", content: "harden the webhook" } }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Capping retries at three." },
              { type: "tool_use", name: "Edit", input: { file_path: `${proj}/src/webhook.ts` } },
              { type: "tool_use", name: "Read", input: { file_path: `${proj}/README.md` } },
            ],
          },
        }),
      ].join("\n"),
    );
    const s = await readSession("claude", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: harden the webhook");
    expect(s.text).toContain("Capping retries at three.");
    expect(s.touched).toEqual(["src/webhook.ts"]); // the Read did not travel
    expect(s.text).not.toContain("README");
  });

  it("gemini — prose from genai parts, writes from toolCalls write_file/replace", async () => {
    const path = join(root, "gemini.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ sessionId: "g1", projectHash: "abc", startTime: "t" }),
        JSON.stringify({ type: "user", content: "add the retry helper" }),
        JSON.stringify({
          type: "gemini",
          content: [{ text: "Added it." }, { functionCall: { name: "write_file" } }],
          toolCalls: [
            { name: "write_file", args: { file_path: `${proj}/src/retry.ts` } },
            { name: "replace", args: { file_path: `${proj}/src/webhook.ts` } },
            { name: "read_file", args: { file_path: `${proj}/notes.md` } },
          ],
        }),
      ].join("\n"),
    );
    const s = await readSession("gemini", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: add the retry helper");
    expect(s.text).toContain("Added it.");
    // The functionCall part carried no prose; only the text survived.
    expect(s.text).not.toContain("functionCall");
    expect(s.touched).toEqual(["src/retry.ts", "src/webhook.ts"]);
    expect(s.touched).not.toContain("notes.md");
  });

  it("codex — located by session id, prose from messages, writes from patch_apply_end", async () => {
    // A rollout a real `codex exec` wrote, placed where the reader looks.
    const home = join(root, "codex-home");
    const day = join(home, "sessions", "2026", "08", "12");
    await mkdir(day, { recursive: true });
    await cp(join(FIXTURES, "codex-rollout.jsonl"), join(day, "rollout-live.jsonl"));
    const prevHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      const cwd = "/work/scratch/proj";
      const s = await readSession(
        "codex",
        { session_id: "019ff4af-db6b-7461-b888-d73762ba206c", cwd },
        0,
      );
      // The task's own words are in the record — the conversation is
      // captured verbatim, as it always was.
      expect(s.text).toContain("create a file named notes.txt");
      // Both files the apply_patch touched, by name, relative to the project.
      expect(s.touched.sort()).toEqual(["README.md", "notes.txt"]);
      // The touched list is NAMES only — every entry a short path, never a
      // patch body or file content. (The prose may quote whatever the user
      // typed, including desired file text; that is the conversation, not
      // the touched channel.)
      expect(s.touched.every((f) => f.length < 200 && !f.includes("\n"))).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevHome;
    }
  });

  it("copilot — events.jsonl by session id, writes from tool.execution_start", async () => {
    const home = join(root, "copilot-home");
    const sid = "cop-1";
    const dir = join(home, "session-state", sid);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "events.jsonl"),
      [
        JSON.stringify({ type: "session.start", data: {} }),
        JSON.stringify({ type: "user.message", data: { content: "wire the queue" } }),
        JSON.stringify({ type: "assistant.message", data: { content: "Wiring it." } }),
        JSON.stringify({
          type: "tool.execution_start",
          data: { toolName: "create", arguments: { path: `${proj}/src/queue.ts` } },
        }),
        JSON.stringify({
          type: "tool.execution_start",
          data: {
            toolName: "str_replace_editor",
            arguments: { command: "view", path: `${proj}/x.ts` },
          },
        }),
      ].join("\n"),
    );
    const prevHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    try {
      const s = await readSession("copilot", { session_id: sid, cwd: proj }, 0);
      expect(s.text).toContain("user: wire the queue");
      expect(s.text).toContain("Wiring it.");
      // create wrote; the str_replace_editor VIEW did not.
      expect(s.touched).toEqual(["src/queue.ts"]);
    } finally {
      if (prevHome === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = prevHome;
    }
  });

  it("cursor — transcript from the payload, Claude-shaped blocks one level down", async () => {
    const path = join(root, "cursor.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "wire the retry" }] },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "Wired." },
              { type: "tool_use", name: "Write", input: { path: `${proj}/src/retry.ts` } },
            ],
          },
        }),
        JSON.stringify({ type: "turn_ended" }),
      ].join("\n"),
    );
    const s = await readSession("cursor", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: wire the retry");
    expect(s.text).toContain("assistant: Wired.");
    expect(s.touched).toEqual(["src/retry.ts"]);
  });

  it("opencode — the session database, in its own part shapes", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dataHome = join(root, "xdg-data");
    await mkdir(join(dataHome, "opencode"), { recursive: true });
    const db = new DatabaseSync(join(dataHome, "opencode", "opencode.db"));
    db.exec(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);" +
        "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);",
    );
    const put = db.prepare("INSERT INTO message VALUES (?, ?, ?)");
    put.run("m1", "s1", JSON.stringify({ role: "user" }));
    put.run("m2", "s1", JSON.stringify({ role: "assistant" }));
    const part = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)");
    part.run("p1", "m1", "s1", JSON.stringify({ type: "text", text: "add the helper" }));
    part.run("p2", "m2", "s1", JSON.stringify({ type: "text", text: "Added." }));
    part.run(
      "p3",
      "m2",
      "s1",
      JSON.stringify({
        type: "tool",
        tool: "write",
        state: { status: "completed", input: { filePath: `${proj}/src/helper.ts` } },
      }),
    );
    part.run(
      "p4",
      "m2",
      "s1",
      JSON.stringify({
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { filePath: `${proj}/notes.md` } },
      }),
    );
    db.close();

    const prev = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dataHome;
    try {
      const s = await readSession("opencode", { session_id: "s1", cwd: proj }, 0);
      expect(s.text).toContain("user: add the helper");
      expect(s.text).toContain("assistant: Added.");
      expect(s.touched).toEqual(["src/helper.ts"]); // the read did not travel
      // The cursor is part rows consumed: a re-read from there is empty.
      const again = await readSession("opencode", { session_id: "s1", cwd: proj }, s.read);
      expect(again.text).toBe("");
    } finally {
      if (prev === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prev;
    }
  });

  it("kilo rides the opencode family under its own paths", async () => {
    // No database on this machine: an empty session, never an error.
    const prev = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, "empty-xdg");
    try {
      const s = await readSession("kilo", { session_id: "nope", cwd: proj }, 0);
      expect(s).toEqual({ text: "", touched: [], read: 0 });
    } finally {
      if (prev === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prev;
    }
  });

  it("muse — run events: started, committed messages, committed tool calls", async () => {
    const path = join(root, "muse.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          payload: { kind: "run", event: { kind: "started", prompt: "fix the cap" } },
        }),
        JSON.stringify({
          payload: { kind: "run", event: { kind: "assistant_message_committed", text: "Capped." } },
        }),
        JSON.stringify({
          payload: {
            kind: "run",
            event: {
              kind: "assistant_tool_calls_committed",
              tool_calls: [
                { name: "edit_file", args: { path: `${proj}/src/cap.ts` } },
                { name: "read_file", args: { path: `${proj}/notes.md` } },
              ],
            },
          },
        }),
      ].join("\n"),
    );
    const s = await readSession("muse", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: fix the cap");
    expect(s.text).toContain("assistant: Capped.");
    expect(s.touched).toEqual(["src/cap.ts"]);
  });

  it("qwen — ChatRecords with gemini-shaped parts and functionCalls", async () => {
    const path = join(root, "qwen.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ type: "user", message: { parts: [{ text: "add retries" }] } }),
        JSON.stringify({
          type: "assistant",
          message: {
            parts: [
              { text: "Added." },
              { functionCall: { name: "write_file", args: { file_path: `${proj}/src/retry.ts` } } },
            ],
          },
        }),
        JSON.stringify({ type: "tool_result", message: {} }),
      ].join("\n"),
    );
    const s = await readSession("qwen", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: add retries");
    expect(s.text).toContain("assistant: Added.");
    expect(s.touched).toEqual(["src/retry.ts"]);
  });

  it("droid — message and tool_call records, ApplyPatch by envelope", async () => {
    const path = join(root, "droid.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ type: "session_start", session_id: "d1" }),
        JSON.stringify({ type: "message", role: "user", content: "wire the queue" }),
        JSON.stringify({ type: "message", role: "assistant", content: "Wired." }),
        JSON.stringify({
          type: "tool_call",
          name: "Edit",
          input: { file_path: `${proj}/src/queue.ts` },
        }),
        JSON.stringify({
          type: "tool_call",
          name: "ApplyPatch",
          input: { input: "*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch" },
        }),
      ].join("\n"),
    );
    const s = await readSession("droid", { transcript_path: path, cwd: proj }, 0);
    expect(s.text).toContain("user: wire the queue");
    expect(s.touched).toEqual(["src/queue.ts", "src/new.ts"]);
  });

  it("grok — ACP update chunks and tool_call rawInput", async () => {
    const path = join(root, "grok.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          params: {
            update: { sessionUpdate: "user_message_chunk", content: { text: "cap retries" } },
          },
        }),
        JSON.stringify({
          params: {
            update: { sessionUpdate: "agent_message_chunk", content: { text: "Capped." } },
          },
        }),
        JSON.stringify({
          params: {
            update: {
              sessionUpdate: "tool_call",
              title: "search_replace",
              rawInput: { file_path: `${proj}/src/cap.ts`, old_string: "5", new_string: "3" },
            },
          },
        }),
      ].join("\n"),
    );
    const s = await readSession("grok", { transcriptPath: path, cwd: proj }, 0);
    expect(s.text).toContain("user: cap retries");
    expect(s.text).toContain("assistant: Capped.");
    expect(s.touched).toEqual(["src/cap.ts"]);
  });

  it("devin — wiring in a bare events file, capture honestly absent", async () => {
    const proj2 = join(root, "devin-proj");
    await mkdir(proj2, { recursive: true });
    const devin = adapterFor("devin")!;
    await devin.install(proj2);
    const hooks = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(proj2, ".devin", "hooks.v1.json"), "utf8"),
    );
    // The file IS the events map — no `hooks` wrapper.
    expect(Object.keys(hooks).sort()).toEqual([
      // Before every act, not only at the top of a turn.
      "PreToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(hooks.SessionStart[0].hooks[0].command).toContain(" hook session-start devin");
    expect((await devin.verify(proj2)).every((w) => w.ok)).toBe(true);
    // No verified record: an empty session, said plainly.
    expect(await devin.read({ session_id: "x" }, 3)).toEqual({ text: "", touched: [], read: 3 });
    await devin.remove(proj2);
    expect((await devin.verify(proj2)).every((w) => !w.ok)).toBe(true);
  });

  it("openclaw — transcript_events sqlite, seq cursor, toolCall writes", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const state = join(root, "claw-state");
    const dbDir = join(state, "agents", "main", "agent");
    await mkdir(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "openclaw-agent.sqlite"));
    db.exec("CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, event_json TEXT);");
    const put = db.prepare("INSERT INTO transcript_events VALUES (?, ?, ?)");
    put.run("cs1", 0, JSON.stringify({ type: "session", id: "cs1" }));
    put.run("cs1", 1, JSON.stringify({ type: "message", role: "user", content: "wire the cache" }));
    put.run(
      "cs1",
      2,
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Wiring it." },
          {
            type: "toolCall",
            id: "t1",
            name: "write",
            arguments: { path: `${proj}/src/cache.ts` },
          },
        ],
      }),
    );
    db.close();

    const prev = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = state;
    try {
      const s = await readSession("openclaw", { session_id: "cs1", cwd: proj }, 0);
      expect(s.text).toContain("user: wire the cache");
      expect(s.text).toContain("assistant: Wiring it.");
      expect(s.touched).toEqual(["src/cache.ts"]);
      // The seq cursor advances past what was read; a re-read is empty.
      const again = await readSession("openclaw", { session_id: "cs1", cwd: proj }, s.read);
      expect(again.text).toBe("");
    } finally {
      if (prev === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = prev;
    }
  });

  it("kiro — session JSONL: Prompt, AssistantMessage with toolUse write", async () => {
    // The real shape a captured Kiro session writes.
    const home = join(root, "kiro-home");
    const dir = join(home, "sessions", "cli");
    await mkdir(dir, { recursive: true });
    const sid = "kiro-1";
    await writeFile(
      join(dir, `${sid}.jsonl`),
      [
        JSON.stringify({
          version: "v1",
          kind: "Prompt",
          data: { message_id: "1", content: [{ kind: "text", data: "add the parser" }] },
        }),
        JSON.stringify({
          version: "v1",
          kind: "AssistantMessage",
          data: {
            message_id: "2",
            content: [
              { kind: "text", data: "Adding it." },
              {
                kind: "toolUse",
                data: {
                  toolUseId: "t1",
                  name: "write",
                  input: { command: "create", path: `${proj}/src/parser.ts` },
                },
              },
            ],
          },
        }),
        JSON.stringify({
          version: "v1",
          kind: "ToolResults",
          data: { content: [{ kind: "toolResult", data: { toolUseId: "t1", status: "success" } }] },
        }),
      ].join("\n"),
    );
    const prev = process.env.KIRO_HOME;
    process.env.KIRO_HOME = home;
    try {
      const s = await readSession("kiro", { session_id: sid, cwd: proj }, 0);
      expect(s.text).toContain("user: add the parser");
      expect(s.text).toContain("assistant: Adding it.");
      expect(s.touched).toEqual(["src/parser.ts"]);
      // Injection is raw text, not a JSON envelope.
      expect(adapterFor("kiro")!.speak("session-start", "ctx", {})).toBe("ctx");
      expect(adapterFor("kiro")!.speak("session-start", null, {})).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.KIRO_HOME;
      else process.env.KIRO_HOME = prev;
    }
  });

  it("kiro wiring: an owned agent file, every moment its harness has", async () => {
    const proj2 = join(root, "kiro-proj");
    await mkdir(proj2, { recursive: true });
    const kiro = adapterFor("kiro")!;
    await kiro.install(proj2);
    const fs = await import("node:fs/promises");
    const agent = JSON.parse(
      await fs.readFile(join(proj2, ".kiro", "agents", "memcell.json"), "utf8"),
    );
    expect(agent.name).toBe("memcell");
    expect(Object.keys(agent.hooks).sort()).toEqual([
      "PreToolUse",
      "agentSpawn",
      "stop",
      "userPromptSubmit",
    ]);
    const wiring = await kiro.verify(proj2);
    // Four wired; session-end honestly not — Kiro has no trigger for it.
    // `before-act` is the fourth: its harness has PreToolUse and always did.
    expect(wiring.filter((w) => w.ok).length).toBe(4);
    expect(wiring.find((w) => w.moment === "session-end")!.ok).toBe(false);
    await kiro.remove(proj2);
    expect((await kiro.verify(proj2)).every((w) => !w.ok)).toBe(true);
  });

  it("antigravity — .agents/hooks.json, injectSteps ephemeralMessage, transcript JSONL with write_to_file", async () => {
    const projAg = join(root, "antigravity-proj");
    await mkdir(projAg, { recursive: true });
    const ag = adapterFor("antigravity")!;
    await ag.install(projAg);
    const hooks = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(projAg, ".agents", "hooks.json"), "utf8"),
    );
    expect(hooks.memcell).toBeTruthy();
    expect(hooks.memcell.PreInvocation[0].command).toContain("hook prompt-submit antigravity");
    expect(hooks.memcell.PreToolUse[0].hooks[0].command).toContain("hook before-act antigravity");
    expect(hooks.memcell.PostInvocation[0].command).toContain("hook turn-end antigravity");
    expect(hooks.memcell.Stop[0].command).toContain("hook session-end antigravity");

    const wiring = await ag.verify(projAg);
    expect(wiring.every((w) => w.ok)).toBe(true);

    const transcriptPath = join(projAg, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ type: "USER_INPUT", content: "implement cache layer" }),
        JSON.stringify({
          type: "PLANNER_RESPONSE",
          content: "Creating cache file.",
          tool_calls: [
            {
              name: "write_to_file",
              args: { TargetFile: `${projAg}/src/cache.ts` },
            },
          ],
        }),
      ].join("\n"),
    );
    const s = await ag.read({ transcript_path: transcriptPath, cwd: projAg }, 0);
    expect(s.text).toContain("user: implement cache layer");
    expect(s.text).toContain("assistant: Creating cache file.");
    expect(s.touched).toEqual(["src/cache.ts"]);

    const { readLatestUserPrompt } = await import("../src/adapters/capture.js");
    const prompt = await readLatestUserPrompt(transcriptPath);
    expect(prompt).toBe("implement cache layer");

    // Also test with <USER_REQUEST> wrapping
    const transcriptWithRequest = join(projAg, "transcript-wrapped.jsonl");
    await writeFile(
      transcriptWithRequest,
      [
        JSON.stringify({
          type: "USER_INPUT",
          content:
            "<USER_REQUEST>\nfix the database pool\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime: 12:00\n</ADDITIONAL_METADATA>",
        }),
      ].join("\n"),
    );
    const wrappedPrompt = await readLatestUserPrompt(transcriptWithRequest);
    expect(wrappedPrompt).toBe("fix the database pool");

    expect(JSON.parse(ag.speak("prompt-submit", "ctx", {})!)).toEqual({
      injectSteps: [{ ephemeralMessage: "ctx" }],
    });
    expect(JSON.parse(ag.refuse!("safety refusal")!)).toEqual({
      decision: "deny",
      reason: "safety refusal",
    });

    await ag.remove(projAg);
    expect((await ag.verify(projAg)).every((w) => !w.ok)).toBe(true);
  });

  it("windsurf — .windsurf/hooks.json, ccHookOps and Cascade tools", async () => {
    const projWs = join(root, "windsurf-proj");
    await mkdir(projWs, { recursive: true });
    const ws = adapterFor("windsurf")!;
    await ws.install(projWs);
    const hooks = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(projWs, ".windsurf", "hooks.json"), "utf8"),
    );
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain("hook before-act windsurf");
    const wiring = await ws.verify(projWs);
    expect(wiring.every((w) => w.ok)).toBe(true);

    const transcriptPath = join(projWs, "cascade.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ role: "user", content: "refactor store" }),
        JSON.stringify({
          role: "assistant",
          content: "Refactoring store.",
          toolCalls: [{ name: "Write", args: { path: `${projWs}/src/store.ts` } }],
        }),
      ].join("\n"),
    );
    const s = await ws.read({ transcript_path: transcriptPath, cwd: projWs }, 0);
    expect(s.text).toContain("user: refactor store");
    expect(s.touched).toEqual(["src/store.ts"]);

    await ws.remove(projWs);
    expect((await ws.verify(projWs)).every((w) => !w.ok)).toBe(true);
  });

  it("goose — .goose/hooks.json, config.yaml extension, developer__write_file tool", async () => {
    const projGoose = join(root, "goose-proj");
    await mkdir(projGoose, { recursive: true });
    const g = adapterFor("goose")!;
    await g.install(projGoose);
    const hooks = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(projGoose, ".goose", "hooks.json"), "utf8"),
    );
    expect(hooks.hooks.PreToolUse[0].command).toContain("hook before-act goose");
    const wiring = await g.verify(projGoose);
    expect(wiring.every((w) => w.ok)).toBe(true);

    const transcriptPath = join(projGoose, "goose.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ role: "user", content: "setup database" }),
        JSON.stringify({
          role: "assistant",
          content: "Creating db.ts.",
          toolCalls: [{ name: "developer__write_file", args: { path: `${projGoose}/src/db.ts` } }],
        }),
      ].join("\n"),
    );
    const s = await g.read({ transcript_path: transcriptPath, cwd: projGoose }, 0);
    expect(s.text).toContain("user: setup database");
    expect(s.touched).toEqual(["src/db.ts"]);

    await g.remove(projGoose);
    expect((await g.verify(projGoose)).every((w) => !w.ok)).toBe(true);
  });

  it("cline — .cline/hooks.json, TaskStart/PreToolUse, and write_to_file", async () => {
    const projCline = join(root, "cline-proj");
    await mkdir(projCline, { recursive: true });
    const cl = adapterFor("cline")!;
    await cl.install(projCline);
    const hooks = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(projCline, ".cline", "hooks.json"), "utf8"),
    );
    expect(hooks.hooks.PreToolUse[0].command).toContain("hook before-act cline");
    const wiring = await cl.verify(projCline);
    expect(wiring.every((w) => w.ok)).toBe(true);

    const transcriptPath = join(projCline, "cline.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ role: "user", content: "update auth" }),
        JSON.stringify({
          role: "assistant",
          content: "Patching auth.",
          toolCalls: [{ name: "write_to_file", args: { path: `${projCline}/src/auth.ts` } }],
        }),
      ].join("\n"),
    );
    const s = await cl.read({ transcript_path: transcriptPath, cwd: projCline }, 0);
    expect(s.text).toContain("user: update auth");
    expect(s.touched).toEqual(["src/auth.ts"]);

    await cl.remove(projCline);
    expect((await cl.verify(projCline)).every((w) => !w.ok)).toBe(true);
  });

  it("an unknown agent reads as empty — silence, never a wrong parse", async () => {
    const s = await readSession("someagent", { transcript_path: join(root, "claude.jsonl") }, 0);
    expect(s).toEqual({ text: "", touched: [], read: 0 });
  });

  it("each adapter speaks its own dialect — and silence beats a guess", () => {
    // Claude names the event; gemini and codex carry bare additionalContext.
    expect(JSON.parse(adapterFor("claude")!.speak("turn-end", "ctx", {})!)).toEqual({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: "ctx" },
    });
    expect(JSON.parse(adapterFor("gemini")!.speak("session-start", "ctx", {})!)).toEqual({
      hookSpecificOutput: { additionalContext: "ctx" },
    });
    expect(JSON.parse(adapterFor("codex")!.speak("prompt-submit", "ctx", {})!)).toEqual({
      hookSpecificOutput: { additionalContext: "ctx" },
    });
    // Copilot's prompt event REPLACES the prompt: the original is echoed
    // back, and with nothing to echo the adapter says nothing at all.
    expect(
      JSON.parse(adapterFor("copilot")!.speak("prompt-submit", "ctx", { prompt: "orig" })!),
    ).toEqual({ modifiedTransformedPrompt: "ctx\n\norig" });
    expect(adapterFor("copilot")!.speak("prompt-submit", "ctx", {})).toBeNull();
    // Cursor speaks its own snake_case field; the opencode family speaks
    // the envelope its bridge plugin parses.
    expect(JSON.parse(adapterFor("cursor")!.speak("session-start", "ctx", {})!)).toEqual({
      additional_context: "ctx",
    });
    expect(JSON.parse(adapterFor("opencode")!.speak("prompt-submit", "ctx", {})!)).toEqual({
      hookSpecificOutput: { additionalContext: "ctx" },
    });
    // Muse names the event like claude; droid and qwen carry the bare
    // envelope; grok and cursor speak snake_case.
    expect(JSON.parse(adapterFor("muse")!.speak("turn-end", "ctx", {})!)).toEqual({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: "ctx" },
    });
    expect(JSON.parse(adapterFor("droid")!.speak("session-start", "ctx", {})!)).toEqual({
      hookSpecificOutput: { additionalContext: "ctx" },
    });
    expect(JSON.parse(adapterFor("qwen")!.speak("session-start", "ctx", {})!)).toEqual({
      hookSpecificOutput: { additionalContext: "ctx" },
    });
    expect(JSON.parse(adapterFor("grok")!.speak("prompt-submit", "ctx", {})!)).toEqual({
      additional_context: "ctx",
    });
    expect(JSON.parse(adapterFor("antigravity")!.speak("before-act", "ctx", {})!)).toEqual({
      injectSteps: [{ ephemeralMessage: "ctx" }],
    });
    // No context: every dialect is silent.
    expect(adapterFor("claude")!.speak("turn-end", null, {})).toBeNull();
  });

  it("the byte offset ships only what is new", async () => {
    const path = join(root, "incremental.jsonl");
    const first = JSON.stringify({ message: { role: "user", content: "first turn" } }) + "\n";
    await writeFile(path, first);
    const a = await readSession("claude", { transcript_path: path, cwd: proj }, 0);
    expect(a.text).toContain("first turn");

    await writeFile(
      path,
      first + JSON.stringify({ message: { role: "assistant", content: "second turn" } }) + "\n",
    );
    const b = await readSession("claude", { transcript_path: path, cwd: proj }, a.read);
    expect(b.text).toContain("second turn");
    expect(b.text).not.toContain("first turn");
  });
});

describe("intent envelope rollup & prompt cleaning", () => {
  it("cleanUserPrompt unwraps user request tags and context summaries", () => {
    const raw = `<CONTEXT_SUMMARY>\n# Previous conversation summary\n</CONTEXT_SUMMARY>\n<USER_REQUEST>deploy the release to production</USER_REQUEST>`;
    expect(cleanUserPrompt(raw)).toBe("deploy the release to production");

    const simple = "  run unit tests  ";
    expect(cleanUserPrompt(simple)).toBe("run unit tests");
  });

  it("readIntentEnvelope falls back to clean raw prompt if no transcript path is provided", async () => {
    const result = await readIntentEnvelope(undefined, "  hello world  ");
    expect(result).toBe("hello world");
  });

  it("readIntentEnvelope rolls up prior substantive prompt with short continuation", async () => {
    const transcriptPath = join(root, "multi-turn.jsonl");
    const lines = [
      JSON.stringify({
        type: "USER_INPUT",
        content: "Please run the full release flow and verify fly.io deployment passes",
      }),
      JSON.stringify({
        type: "PLANNER_RESPONSE",
        content: "I will check the release status.",
      }),
      JSON.stringify({
        type: "USER_INPUT",
        content: "yes please",
      }),
    ];
    await writeFile(transcriptPath, lines.join("\n") + "\n");

    const intent = await readIntentEnvelope(transcriptPath, "yes please");
    expect(intent).toBe(
      "Please run the full release flow and verify fly.io deployment passes\n\nUser instruction: yes please",
    );
  });

  it("readIntentEnvelope does not rollup if current prompt is already substantive", async () => {
    const transcriptPath = join(root, "substantive.jsonl");
    const longPrompt =
      "Here is a completely new substantive task description that exceeds 120 characters in total length so it should not roll up with any prior conversation context.";
    const lines = [
      JSON.stringify({
        type: "USER_INPUT",
        content: "Previous task that was also very substantive and completed earlier",
      }),
      JSON.stringify({
        type: "USER_INPUT",
        content: longPrompt,
      }),
    ];
    await writeFile(transcriptPath, lines.join("\n") + "\n");

    const intent = await readIntentEnvelope(transcriptPath, longPrompt);
    expect(intent).toBe(longPrompt);
  });

  it("isGuard classifies standing invariants, action rules, and pinned rules as guards", () => {
    expect(isGuard({ statementId: "s1", text: "Any rule", confidence: 0.8, layer: "org", standing: true })).toBe(true);
    expect(isGuard({ statementId: "s2", text: "Any rule", confidence: 0.8, layer: "org", pinned: true })).toBe(true);
    expect(isGuard({ statementId: "s3", text: "Any rule", confidence: 0.8, layer: "org", appliesAt: ["send"] })).toBe(true);
    expect(isGuard({ statementId: "s4", text: "Any rule", confidence: 0.8, layer: "org", refuses: true })).toBe(true);
    expect(isGuard({ statementId: "s5", text: "Any rule", confidence: 0.8, layer: "org", kind: "gotcha" })).toBe(true);
    expect(isGuard({ statementId: "s6", text: "Some observation about weather", confidence: 0.8, layer: "org" })).toBe(false);
  });

  it("asContext places standing invariants in operational guards section ahead of soft conventions", () => {
    const results = [
      {
        statementId: "s-guard-1",
        text: "Releases must go through release-please.",
        confidence: 0.9,
        layer: "org",
        standing: true,
        appliesAt: ["send"],
      },
      {
        statementId: "s-conv-1",
        text: "Buttons use the centralized Button component.",
        confidence: 0.6,
        layer: "team",
      },
    ];

    const ctx = asContext(results, "test-space", "deploy release");
    expect(ctx).toContain("OPERATIONAL GUARDS & INVARIANTS");
    expect(ctx).toContain("Releases must go through release-please.");
    expect(ctx).toContain("From this project's memory (test-space) — already learned here:");
    expect(ctx).toContain("Buttons use the centralized Button component.");
    // Guard must appear before soft conventions in context string
    expect(ctx.indexOf("OPERATIONAL GUARDS & INVARIANTS")).toBeLessThan(
      ctx.indexOf("From this project's memory"),
    );
  });
});
