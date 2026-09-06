import type { Surface } from "./surface.js";
import { join, resolve } from "node:path";

import { hookCommand, hookMatches, MOMENTS, type Moment } from "../loop/moments.js";
import {
  addTouched,
  emptySession,
  patchPaths,
  pathOf,
  readJsonlSlice,
  TOUCHED_CAP,
  type Incoming,
  type Session,
} from "./capture.js";
import {
  MCP_ARGS,
  MCP_COMMAND,
  oursMcp,
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
  type Wiring,
  missingMoments,
  staleText,
} from "./shared.js";

// Cline / Roo Code.
// Hooks live in <project>/.cline/hooks.json, with additionalContext for
// injection, exit-code 2 / decision denial for refusal, and MCP configured
// in <project>/.cline/mcp.json.

const EVENT: Record<Moment, string> = {
  "session-start": "TaskStart",
  "prompt-submit": "TaskResume",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "TaskEnd",
};

interface HookEntry {
  type?: string;
  command: string;
  timeout?: number;
}

interface HooksFile {
  version?: number;
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

const file = (dir: string) => join(dir, ".cline", "hooks.json");
const mcpFile = (dir: string) => join(dir, ".cline", "mcp.json");

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(dir: string): Promise<void> {
  const at = mcpFile(dir);
  const doc = await readJson<McpFile>(at);
  doc.mcpServers ??= {};
  doc.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
  await writeJson(at, doc);
}

async function removeMcp(dir: string): Promise<boolean> {
  const at = mcpFile(dir);
  const doc = await readJson<McpFile>(at);
  if (!doc.mcpServers || !oursMcp(doc.mcpServers.memcell)) return false;
  delete doc.mcpServers.memcell;
  await rmIfEmptied(at, doc, "mcpServers");
  return true;
}

const WRITE_TOOLS = new Set([
  "write_to_file",
  "replace_in_file",
  "apply_patch",
  "Write",
  "Edit",
  "write",
  "edit",
  "write_file",
  "edit_file",
]);

export const cline: Adapter = {
  name: "cline",
  get surface() {
    return SURFACE;
  },

  async stale(dir: string): Promise<boolean> {
    const files = [file(resolve(dir))];
    return (await staleText(files)) || missingMoments(files, Object.values(EVENT));
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const doc = await readJson<HooksFile>(at);
    doc.version ??= 1;
    doc.hooks ??= {};

    for (const moment of MOMENTS) {
      const entries = (doc.hooks[EVENT[moment]] ??= []);
      const command = hookCommand(moment, "cline");
      let held = false;
      for (const entry of entries) {
        if (hookMatches(entry.command, moment, "cline")) {
          entry.command = command;
          held = true;
        }
      }
      if (!held) {
        entries.push({ type: "command", command, timeout: 30 });
      }
    }

    await writeJson(at, doc);
    await installMcp(resolve(projectDir)).catch(() => undefined);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    const doc = await readJson<HooksFile>(at);
    let changed = false;

    for (const [event, entries] of Object.entries(doc.hooks ?? {})) {
      const filtered = entries.filter((e) => !e.command.includes("memcell"));
      if (filtered.length !== entries.length) {
        changed = true;
        if (doc.hooks) doc.hooks[event] = filtered;
      }
      if (doc.hooks?.[event]?.length === 0) delete doc.hooks[event];
    }

    await removeMcp(resolve(projectDir)).catch(() => undefined);

    if (!changed) return null;
    await rmIfEmptied(at, doc, "hooks");
    return at;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const doc = await readJson<HooksFile>(file(resolve(projectDir)));
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: Boolean(doc.hooks?.[EVENT[moment]]?.some((e) => hookMatches(e.command, moment, "cline"))),
    }));
  },

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      hookSpecificOutput: { additionalContext: context },
    });
  },

  refuse(reason: string): string | null {
    return JSON.stringify({
      decision: "deny",
      reason,
    });
  },

  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];

    const read = await readJsonlSlice(path, from, (raw) => {
      const rec = raw as {
        role?: string;
        content?: unknown;
        toolCalls?: { name?: string; args?: Record<string, unknown> }[];
      };
      if (rec.role && rec.content) {
        const text = String(rec.content);
        if (text.trim()) said.push(`${rec.role}: ${text.trim()}`);
      }
      for (const call of rec.toolCalls ?? []) {
        if (WRITE_TOOLS.has(call.name ?? "")) {
          addTouched(touched, pathOf(call.args), payload.cwd);
          const patch = typeof call.args?.patch === "string" ? call.args.patch : "";
          if (patch) for (const p of patchPaths(patch)) addTouched(touched, p, payload.cwd);
        }
      }
    });

    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

export const SURFACE: Surface = {
  moments: {
    "session-start": {
      event: "TaskStart",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "prompt-submit": {
      event: "TaskResume",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "before-act": {
      event: "PreToolUse",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "turn-end": {
      event: "Stop",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "session-end": {
      event: "TaskEnd",
      inject: { unsupported: "the session is over — there is nobody left to tell" },
    },
  },
  guard: {
    event: "PreToolUse",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: ["read_file", "list_files", "search_files", "view_file"],
      change: [...WRITE_TOOLS],
      record: ["execute_command", "run_command", "Bash"],
      send: ["execute_command", "run_command", "Bash"],
    },
  },
};
