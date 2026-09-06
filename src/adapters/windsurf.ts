import type { Surface } from "./surface.js";
import { join } from "node:path";

import type { Moment } from "../loop/moments.js";
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
import { ccHookOps } from "./cc-hooks.js";
import {
  MCP_ARGS,
  MCP_COMMAND,
  oursMcp,
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
} from "./shared.js";

// Windsurf IDE / Cascade agent (Codeium).
// Claude-shaped hooks in <project>/.windsurf/hooks.json, with
// hookSpecificOutput.additionalContext for injection and exit code 2
// (or JSON deny) for refusal. MCP registration in <project>/.windsurf/mcp_config.json.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const file = (dir: string) => join(dir, ".windsurf", "hooks.json");
const mcpFile = (dir: string) => join(dir, ".windsurf", "mcp_config.json");

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(dir: string): Promise<void> {
  const doc = await readJson<McpFile>(mcpFile(dir));
  doc.mcpServers ??= {};
  doc.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
  await writeJson(mcpFile(dir), doc);
}

async function removeMcp(dir: string): Promise<boolean> {
  const doc = await readJson<McpFile>(mcpFile(dir));
  if (!doc.mcpServers || !oursMcp(doc.mcpServers.memcell)) return false;
  delete doc.mcpServers.memcell;
  await rmIfEmptied(mcpFile(dir), doc, "mcpServers");
  return true;
}

const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "write",
  "edit",
  "write_file",
  "edit_file",
  "apply_patch",
]);

const wiring = ccHookOps("windsurf", file, EVENT, {
  afterInstall: installMcp,
  alsoRemove: removeMcp,
  legacy: (dir) => [join(dir, ".codeium", "windsurf", "hooks.json")],
});

export const windsurf: Adapter = {
  name: "windsurf",
  surface: {
    moments: {
      "session-start": {
        event: "SessionStart",
        inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
      },
      "prompt-submit": {
        event: "UserPromptSubmit",
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
        event: "SessionEnd",
        inject: { unsupported: "the session is over — there is nobody left to tell" },
      },
    },
    guard: {
      event: "PreToolUse",
      matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
      refuse: { via: "exit-code", code: 2 },
      tools: {
        read: ["Read", "View", "Glob", "Grep", "read_file", "view_file"],
        change: [...WRITE_TOOLS],
        record: ["RunCommand", "run_command", "Bash"],
        send: ["RunCommand", "run_command", "Bash"],
      },
    },
  },
  ...wiring,

  speak(moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: EVENT[moment],
        additionalContext: context,
      },
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
        type?: string;
        role?: string;
        content?: unknown;
        message?: { role?: string; content?: unknown };
        toolCalls?: { name?: string; args?: Record<string, unknown> }[];
      };

      const role = rec.role ?? rec.message?.role ?? (rec.type === "user" ? "user" : null);
      if (role && (rec.content || rec.message?.content)) {
        const text = String(rec.content ?? rec.message?.content ?? "");
        if (text.trim()) said.push(`${role}: ${text.trim()}`);
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
