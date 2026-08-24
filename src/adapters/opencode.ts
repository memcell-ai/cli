import type { Surface } from "./surface.js";
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
  writeJson,
  type Adapter,
  type Wiring,
  oursMcp,
  missingMoments,
  staleText,
} from "./shared.js";

// The opencode family — opencode itself and Kilo, which is its fork and
// keeps the same plugin API, config shape and record schema under different
// names and paths. One adapter, instantiated twice.
//
// opencode has no command-hook config: its integration surface is a
// TypeScript PLUGIN run by its own runtime. So what this adapter installs
// is a plugin file that bridges the same law as every hook — it execs the
// frozen `memcell hook` command with the moment's payload on stdin and
// speaks back what memcell answers. The plugin is project-side and
// committable, carries no secret, and is removed whole by its markers.
//
// The record is SQLite, read through node:sqlite — and read FAIL-OPEN: a
// runtime without the module, a locked database, a schema this build does
// not know, all read as an empty session rather than an error inside
// somebody's coding session.

interface Family {
  /** The program name — what `--agent` takes and hooks fire as. */
  name: string;
  /** The project config file carrying the MCP block. */
  configFile: string;
  /** The project plugin directory. */
  pluginDir: string;
  /** The session database, resolved at read time. */
  dbPath: () => string;
}

const dataHome = (): string => process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");

export const OPENCODE: Family = {
  name: "opencode",
  configFile: "opencode.json",
  pluginDir: join(".opencode", "plugins"),
  dbPath: () => join(dataHome(), "opencode", "opencode.db"),
};

export const KILO: Family = {
  name: "kilo",
  configFile: "kilo.json",
  pluginDir: join(".kilocode", "plugin"),
  dbPath: () => join(dataHome(), "kilo", "kilo.db"),
};

const BEGIN = "// memcell:begin — managed plugin, removed whole by `memcell hook remove`";
const END = "// memcell:end";

/** The bridge plugin, frozen with the wired agent's id. It maps the plugin
 *  API onto the loop's moments: the first message of a session is its
 *  session-start, later ones are prompt-submit, and the session going idle
 *  is the turn end. Every path fails open — a memcell that is down must
 *  never break the session. */
const plugin = (program: string): string =>
  `${BEGIN}
import { spawn } from "node:child_process";

const fire = (moment, payload) =>
  new Promise((done) => {
    const p = spawn("memcell", ["hook", moment, "${program}"], {
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

export const MemcellPlugin = async ({ directory }) => {
  const seen = new Set();
  return {
    "chat.message": async (input, output) => {
      const sessionID = input?.sessionID ?? output?.message?.sessionID;
      const moment = sessionID && seen.has(sessionID) ? "prompt-submit" : "session-start";
      if (sessionID) seen.add(sessionID);
      const prompt = (output?.parts ?? [])
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\\n");
      const answer = await fire(moment, { cwd: directory, session_id: sessionID, prompt });
      const context = answer?.hookSpecificOutput?.additionalContext;
      if (context && Array.isArray(output?.parts)) {
        // A part is a record with an identity, not a fragment — the schema
        // requires id, sessionID and messageID, so the injection mints a
        // complete one on the message it rides.
        output.parts.push({
          id: "prt_memcell" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36),
          sessionID: output?.message?.sessionID ?? sessionID,
          messageID: output?.message?.id,
          type: "text",
          text: context,
          synthetic: true,
        });
      }
    },
    event: async ({ event }) => {
      if (event?.type !== "session.idle") return;
      await fire("turn-end", {
        cwd: directory,
        session_id: event?.properties?.sessionID ?? event?.properties?.sessionId,
      });
    },
  };
};
${END}
`;

/** The four moments as the plugin realizes them — session-end has no
 *  plugin event worth trusting yet, and the wiring says so honestly. */
const EVENT: Record<Moment, string> = {
  "session-start": "chat.message (first of session)",
  "prompt-submit": "chat.message",
  "before-act": "tool.execute.before",
  "turn-end": "event session.idle",
  "session-end": "—",
};

/** Rows this family's write tools produce. */
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "multiedit"]);

export function opencodeFamily(family: Family): Adapter {
  const pluginFile = (dir: string) => join(dir, family.pluginDir, "memcell.ts");
  const configFile = (dir: string) => join(dir, family.configFile);

  return {
    name: family.name,
    get surface() {
      return SURFACE;
    },

    /** An older release's shape — a path or an --agent in the wiring. */
    async stale(projectDir: string): Promise<boolean> {
      const files = [pluginFile(resolve(projectDir)), configFile(resolve(projectDir))];
      // Wiring of the right shape that predates a moment — what every
      // upgrade adding one leaves behind. Caught here so the first hook
      // after an upgrade carries itself forward and nobody is told to.
      return (await staleText(files)) || missingMoments(files, Object.values(EVENT));
    },

    async install(projectDir: string): Promise<string> {
      const at = pluginFile(resolve(projectDir));
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, plugin(family.name));
      // The MCP registration rides opencode's own config: type local, the
      // bridge command, nothing else.
      const cfg = await readJson<{ mcp?: Record<string, unknown>; [k: string]: unknown }>(
        configFile(resolve(projectDir)),
      );
      cfg.mcp ??= {};
      cfg.mcp.memcell = { type: "local", command: [MCP_COMMAND, ...MCP_ARGS], enabled: true };
      await writeJson(configFile(resolve(projectDir)), cfg);
      return at;
    },

    async remove(projectDir: string): Promise<string | null> {
      const at = pluginFile(resolve(projectDir));
      const held = await readFile(at, "utf8").catch(() => null);
      let removed = false;
      // Ours is removed whole, and ONLY ours — a plugin somebody edited
      // past the markers is left for them rather than guessed at.
      if (held !== null && held.startsWith(BEGIN)) {
        await rm(at, { force: true });
        removed = true;
      }
      const cfgAt = configFile(resolve(projectDir));
      const cfg = await readJson<{ mcp?: Record<string, unknown>; [k: string]: unknown }>(cfgAt);
      if (cfg.mcp && isOursLocal(cfg.mcp.memcell)) {
        delete cfg.mcp.memcell;
        if (Object.keys(cfg.mcp).length === 0) delete cfg.mcp;
        await writeJson(cfgAt, cfg);
        removed = true;
      }
      return removed ? at : null;
    },

    async verify(projectDir: string): Promise<Wiring[]> {
      const held = await readFile(pluginFile(resolve(projectDir)), "utf8").catch(() => "");
      const wired = held.startsWith(BEGIN) && held.includes(`"${family.name}"`);
      return (Object.keys(EVENT) as Moment[]).map((moment) => ({
        moment,
        event: EVENT[moment],
        ok: moment === "session-end" ? false : wired,
      }));
    },

    // ── speak — the bridge plugin parses this envelope ───────────────────
    speak(_moment: Moment, context: string | null): string | null {
      if (!context) return null;
      return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
    },

    // ── read — the session database, fail-open ───────────────────────────
    // part rows carry the session's text and tool calls as JSON `data`;
    // the read cursor is how many of the session's parts have already
    // shipped, so a turn slices only what is new.
    async read(payload: Incoming, from: number): Promise<Session> {
      const sid = payload.session_id ?? payload.sessionId;
      if (!sid) return emptySession(from);
      let rows: { mdata: string | null; pdata: string | null }[];
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(family.dbPath(), { readOnly: true });
        try {
          rows = db
            .prepare(
              `SELECT m.data AS mdata, p.data AS pdata
               FROM part p JOIN message m ON m.id = p.message_id
               WHERE p.session_id = ? ORDER BY p.id`,
            )
            .all(sid) as { mdata: string | null; pdata: string | null }[];
        } finally {
          db.close();
        }
      } catch {
        // No module, no database, or a schema this build does not know:
        // an empty session, never an error in somebody's coding session.
        return emptySession(from);
      }

      const said: string[] = [];
      const touched: string[] = [];
      for (const row of rows.slice(from)) {
        try {
          const message = JSON.parse(row.mdata ?? "{}") as { role?: string };
          const part = JSON.parse(row.pdata ?? "{}") as {
            type?: string;
            text?: string;
            synthetic?: boolean;
            tool?: string;
            state?: { input?: Record<string, unknown> };
          };
          // Synthetic parts are what memcell itself injected — reading them
          // back would hand the memory its own words as the session's.
          if (part.type === "text" && part.text?.trim() && !part.synthetic) {
            const role = message.role === "user" ? "user" : "assistant";
            said.push(`${role}: ${part.text.trim()}`);
          } else if (part.type === "tool" && WRITE_TOOLS.has(part.tool ?? "")) {
            addTouched(touched, pathOf(part.state?.input), payload.cwd);
          }
        } catch {
          // One malformed row is not a reason to lose the rest.
        }
      }
      return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read: rows.length };
    },
  };
}

/** Our MCP entry in this family's dialect. */
const isOursLocal = (entry: unknown): boolean =>
  typeof entry === "object" &&
  entry !== null &&
  (entry as { type?: string }).type === "local" &&
  Array.isArray((entry as { command?: string[] }).command) &&
  oursMcp(entry);

export const opencode: Adapter = opencodeFamily(OPENCODE);
export const kilo: Adapter = opencodeFamily(KILO);

/**
 * What this harness can do, declared — see surface.ts.
 *
 * `tools` is the piece that can live nowhere else. The record holds five
 * words every trade shares and knows nothing about tools, because it
 * outlives whichever agents exist. Naming which of THIS agent's tools count
 * as sending is knowledge about one harness, and this is the file allowed to
 * hold it.
 *
 * `change` is the same set the capture side already learned — one list, so
 * the two halves cannot drift into disagreeing about what a write is. A tool
 * nobody verified is left out: that act goes unguarded, which is silence
 * rather than a rule shown where it does not apply.
 */
export const SURFACE: Surface = {
  moments: {
    "session-start": {
      event: "chat.message (first of session)",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "prompt-submit": {
      event: "chat.message",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "before-act": {
      event: "tool.execute.before",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "turn-end": {
      event: "event session.idle",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "session-end": {
      event: "—",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
  },
  guard: {
    event: "tool.execute.before",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: ["read", "grep", "glob", "webfetch", "websearch"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["bash"],
      send: ["bash"],
    },
  },
};
