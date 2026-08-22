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

// Factory Droid. The closest dialect to Claude Code's: the same nested
// hooks JSON (in <project>/.factory/hooks.json), `transcript_path` on every
// hook's stdin, and hookSpecificOutput.additionalContext for injection. The
// MCP registration rides <project>/.factory/mcp.json.
//
// The record shape matches the agent's documentation, not yet driven
// live: a JSONL of a
// session_start header plus message / tool_call / tool_result records,
// writes named Create · Edit · ApplyPatch with the path in the tool input.
// The reader is deliberately tolerant of spelling, and anything it does not
// recognize reads as nothing.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const file = (dir: string) => join(dir, ".factory", "hooks.json");
const mcpFile = (dir: string) => join(dir, ".factory", "mcp.json");

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

const WRITE_TOOLS = new Set(["Create", "Edit", "ApplyPatch", "create", "edit", "apply_patch"]);

export const droid: Adapter = {
  name: "droid",
  ...ccHookOps("droid", file, EVENT, { afterInstall: installMcp, alsoRemove: removeMcp }),

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
  },

  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as {
        type?: string;
        role?: string;
        content?: unknown;
        text?: string;
        name?: string;
        tool_name?: string;
        input?: Record<string, unknown>;
        tool_input?: Record<string, unknown>;
      };
      if (entry.type === "message" || entry.role) {
        const role = entry.role;
        if (role !== "user" && role !== "assistant") return;
        const text =
          typeof entry.content === "string"
            ? entry.content
            : (entry.text ?? blockText(entry.content));
        if (text.trim()) said.push(`${role}: ${text.trim()}`);
      } else if (entry.type === "tool_call") {
        const name = entry.name ?? entry.tool_name ?? "";
        if (!WRITE_TOOLS.has(name)) return;
        const input = entry.input ?? entry.tool_input;
        if (name.toLowerCase().includes("patch")) {
          const patch = typeof input === "string" ? input : String(input?.input ?? "");
          for (const f of patchPaths(patch)) addTouched(touched, f, payload.cwd);
        } else {
          addTouched(touched, pathOf(input), payload.cwd);
        }
      }
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

function blockText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { text: string } => typeof (c as { text?: unknown })?.text === "string")
    .map((c) => c.text)
    .join("\n");
}
