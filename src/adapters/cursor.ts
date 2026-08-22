import { join, resolve } from "node:path";

import { hookCommand, hookMatches, MOMENTS, type Moment } from "../loop/moments.js";
import {
  addTouched,
  emptySession,
  pathOf,
  readJsonlSlice,
  TOUCHED_CAP,
  type Incoming,
  type Session,
} from "./capture.js";
import {
  MCP_ARGS,
  MCP_COMMAND,
  ours,
  oursMcp,
  readJson,
  writeJson,
  type Adapter,
  type Wiring,
  staleText,
} from "./shared.js";

// Cursor CLI. Hooks go in <project>/.cursor/hooks.json — its own flat shape
// (`{ version: 1, hooks: { <event>: [{ command }] } }`), not the nested
// Claude one, though its payloads and tool names are Claude-compatible and
// it hands `transcript_path` on every firing. The MCP registration rides
// <project>/.cursor/mcp.json, the same file the editor reads.
//
// Wired against the CLI's verified event subset: sessionStart,
// beforeSubmitPrompt and stop fire today; sessionEnd is wired but the
// harness's support for it is young — absence there is the harness's, and
// turn-end capture carries the leg either way.

const EVENT: Record<Moment, string> = {
  "session-start": "sessionStart",
  "prompt-submit": "beforeSubmitPrompt",
  "turn-end": "stop",
  "session-end": "sessionEnd",
};

interface HooksFile {
  version?: number;
  hooks?: Record<string, { command: string }[]>;
  [k: string]: unknown;
}

const file = (dir: string) => join(dir, ".cursor", "hooks.json");
const mcpFile = (dir: string) => join(dir, ".cursor", "mcp.json");

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Cursor's transcript records writes as Claude-shaped tool_use blocks. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "write", "edit"]);

export const cursor: Adapter = {
  name: "cursor",

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    return staleText([join(resolve(dir), ".cursor", "hooks.json")]);
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const held = await readJson<HooksFile>(at);
    held.version ??= 1;
    held.hooks ??= {};
    for (const moment of MOMENTS) {
      const entries = (held.hooks[EVENT[moment]] ??= []);
      const command = hookCommand(moment, "cursor");
      let refreshed = false;
      for (const entry of entries) {
        if (hookMatches(entry.command, moment, "cursor")) {
          entry.command = command;
          refreshed = true;
        }
      }
      if (!refreshed) entries.push({ command });
    }
    await writeJson(at, held);

    const mcpAt = mcpFile(resolve(projectDir));
    const mcp = await readJson<McpFile>(mcpAt);
    mcp.mcpServers ??= {};
    mcp.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
    await writeJson(mcpAt, mcp);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    let removed = false;

    const mcpAt = mcpFile(resolve(projectDir));
    const mcp = await readJson<McpFile>(mcpAt);
    if (mcp.mcpServers && oursMcp(mcp.mcpServers.memcell)) {
      delete mcp.mcpServers.memcell;
      if (Object.keys(mcp.mcpServers).length === 0) delete mcp.mcpServers;
      await writeJson(mcpAt, mcp);
      removed = true;
    }

    const held = await readJson<HooksFile>(at);
    if (held.hooks) {
      let changed = false;
      for (const [event, entries] of Object.entries(held.hooks)) {
        const kept = entries.filter((e) => !ours(e.command));
        if (kept.length !== entries.length) changed = true;
        if (kept.length === 0) delete held.hooks[event];
        else held.hooks[event] = kept;
      }
      if (changed) {
        await writeJson(at, held);
        removed = true;
      }
    }
    return removed ? at : null;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const held = await readJson<HooksFile>(file(resolve(projectDir)));
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: Boolean(
        held.hooks?.[EVENT[moment]]?.some((e) => hookMatches(e.command, moment, "cursor")),
      ),
    }));
  },

  // ── speak — snake_case, cursor's own field ────────────────────────────────
  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ additional_context: context });
  },

  // ── read — the transcript its hook payload names ─────────────────────────
  // JSONL under ~/.cursor/projects/<ws>/agent-transcripts/: message lines
  // carry `{ role, message: { content: [blocks] } }` — Claude-shaped blocks
  // one level down — plus control lines like `turn_ended` that carry no
  // role and read as nothing.
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as {
        role?: string;
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      const role = entry.role ?? entry.message?.role;
      if (role !== "user" && role !== "assistant") return;
      const content = entry.message?.content;
      if (!content) return;
      if (Array.isArray(content)) {
        for (const block of content as {
          type?: string;
          name?: string;
          text?: string;
          input?: Record<string, unknown>;
        }[]) {
          if (block?.type === "tool_use" && WRITE_TOOLS.has(block.name ?? "")) {
            addTouched(touched, pathOf(block.input), payload.cwd);
          }
        }
      }
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter(
                  (c): c is { type: string; text: string } =>
                    (c as { type?: string })?.type === "text",
                )
                .map((c) => c.text)
                .join("\n")
            : "";
      if (text.trim()) said.push(`${role}: ${text.trim()}`);
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};
