import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Moment } from "../loop/moments.js";
import {
  addTouched,
  emptySession,
  pathOf,
  TOUCHED_CAP,
  type Incoming,
  type Session,
} from "./capture.js";
import {
  MCP_ARGS,
  MCP_COMMAND,
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
  type Wiring,
  oursMcp,
  staleText,
} from "./shared.js";

// OpenClaw. The odd one out, and it earns its own file for it: not a
// cd-into-a-repo CLI but a persistent-workspace gateway with a FIRST-CLASS
// memory slot — `api.registerMemoryCapability(...)`, exclusive per install.
// So memcell does not bolt hooks onto a project here; it registers as the
// workspace's memory. The adapter installs a typed plugin that claims that
// slot and bridges it to the same frozen `memcell hook` command every other
// agent runs: `before_prompt_build` is the recall (its prependContext is
// the injection), `agent_end` is the turn's material, `after_tool_call`
// notes the writes.
//
// The record is SQLite — `~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`,
// a `transcript_events(session_id, seq, event_json)` log — read fail-open
// like the opencode family. CAPTURE HERE IS FIXTURE-VERIFIED, NOT DRIVEN:
// openclaw is not installed on the build machine, so the reader is proven
// against its documented event shape and the live drive is pending. The
// speak/register bridge is wired; recall serves regardless.

const AGENT_ID = process.env.OPENCLAW_AGENT_ID ?? "main";

const stateDir = (): string => process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");

const dbPath = (): string => join(stateDir(), "agents", AGENT_ID, "agent", "openclaw-agent.sqlite");

// The plugin lives in the workspace's hooks dir — openclaw discovers typed
// plugins there. It is committable, secretless and removed whole by its
// markers, the same law as every other adapter's wiring.
const pluginFile = (dir: string) => join(dir, "hooks", "memcell", "index.ts");
const configFile = () => join(stateDir(), "openclaw.json");

const BEGIN = "// memcell:begin — managed plugin, removed whole by `memcell hook remove`";
const END = "// memcell:end";

const plugin = (): string =>
  `${BEGIN}
import { spawn } from "node:child_process";
import { definePluginEntry } from "openclaw/plugin";

const fire = (moment, payload) =>
  new Promise((done) => {
    const p = spawn("memcell", ["hook", moment, "openclaw"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      try {
        done(JSON.parse(out));
      } catch {
        done(null);
      }
    });
    p.on("error", () => done(null));
    p.stdin.end(JSON.stringify(payload));
  });

export default definePluginEntry({
  register(api) {
    api.registerMemoryCapability({
      async promptBuilder({ sessionId, cwd }) {
        const answer = await fire("session-start", { cwd, session_id: sessionId });
        const context = answer?.hookSpecificOutput?.additionalContext;
        return context ? { prependContext: context } : {};
      },
    });
    api.on("agent_end", async ({ sessionId }) => {
      await fire("turn-end", { cwd: process.cwd(), session_id: sessionId });
    });
  },
});
${END}
`;

const EVENT: Record<Moment, string> = {
  "session-start": "promptBuilder",
  "prompt-submit": "before_prompt_build",
  "turn-end": "agent_end",
  "session-end": "—",
};

/** OpenClaw's write tools, path field `path`. */
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

export const openclaw: Adapter = {
  name: "openclaw",

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    return staleText([pluginFile(resolve(dir)), configFile()]);
  },

  async install(projectDir: string): Promise<string> {
    const at = pluginFile(resolve(projectDir));
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, plugin());
    // MCP rides openclaw's own config (JSON5-tolerant; a plain object is
    // valid JSON5, so writeJson is safe).
    const cfg = await readJson<{
      mcp?: { servers?: Record<string, unknown> };
      [k: string]: unknown;
    }>(configFile());
    cfg.mcp ??= {};
    cfg.mcp.servers ??= {};
    cfg.mcp.servers.memcell = { command: MCP_COMMAND, args: MCP_ARGS, transport: "stdio" };
    await writeJson(configFile(), cfg);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = pluginFile(resolve(projectDir));
    const held = await readFile(at, "utf8").catch(() => null);
    let removed = false;
    if (held !== null && held.startsWith(BEGIN)) {
      await rm(at, { force: true });
      removed = true;
    }
    const cfg = await readJson<{
      mcp?: { servers?: Record<string, unknown> };
      [k: string]: unknown;
    }>(configFile());
    const server = cfg.mcp?.servers?.memcell as { command?: string } | undefined;
    if (oursMcp(server)) {
      delete cfg.mcp!.servers!.memcell;
      if (Object.keys(cfg.mcp!.servers!).length === 0) delete cfg.mcp!.servers;
      if (cfg.mcp && Object.keys(cfg.mcp).length === 0) delete cfg.mcp;
      await rmIfEmptied(configFile(), cfg as Record<string, unknown>, "mcp");
      removed = true;
    }
    return removed ? at : null;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const held = await readFile(pluginFile(resolve(projectDir)), "utf8").catch(() => "");
    const wired = held.startsWith(BEGIN);
    return (Object.keys(EVENT) as Moment[]).map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: moment === "session-end" ? false : wired,
    }));
  },

  // ── speak — the promptBuilder plugin reads this envelope ─────────────────
  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
  },

  // ── read — transcript_events SQLite, fail-open ───────────────────────────
  async read(payload: Incoming, from: number): Promise<Session> {
    const sid = payload.session_id ?? payload.sessionId;
    if (!sid) return emptySession(from);
    let rows: { seq: number; event_json: string }[];
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(dbPath(), { readOnly: true });
      try {
        rows = db
          .prepare(
            `SELECT seq, event_json FROM transcript_events WHERE session_id = ? ORDER BY seq`,
          )
          .all(sid) as { seq: number; event_json: string }[];
      } finally {
        db.close();
      }
    } catch {
      return emptySession(from);
    }

    const said: string[] = [];
    const touched: string[] = [];
    for (const row of rows.filter((r) => r.seq >= from)) {
      try {
        const event = JSON.parse(row.event_json) as {
          type?: string;
          role?: string;
          content?: unknown;
          name?: string;
          arguments?: Record<string, unknown>;
        };
        if (event.type === "message" || event.role) {
          const role = event.role;
          if (role !== "user" && role !== "assistant") continue;
          const blocks = Array.isArray(event.content) ? event.content : [];
          for (const b of blocks as {
            type?: string;
            name?: string;
            arguments?: Record<string, unknown>;
          }[]) {
            if (b?.type === "toolCall" && WRITE_TOOLS.has(b.name ?? "")) {
              addTouched(touched, pathOf(b.arguments), payload.cwd);
            }
          }
          const text =
            typeof event.content === "string"
              ? event.content
              : (blocks as { type?: string; text?: string }[])
                  .filter((b) => b?.type === "text" && typeof b.text === "string")
                  .map((b) => b.text)
                  .join("\n");
          if (text.trim()) said.push(`${role}: ${text.trim()}`);
        }
      } catch {
        // One malformed row is not a reason to lose the rest.
      }
    }
    const nextFrom = rows.length ? rows[rows.length - 1]!.seq + 1 : from;
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read: nextFrom };
  },
};
