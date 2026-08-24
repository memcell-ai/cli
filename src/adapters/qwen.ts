import type { Surface } from "./surface.js";
import { join } from "node:path";

import type { Moment } from "../loop/moments.js";
import {
  addTouched,
  emptySession,
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

// Qwen Code. It forked from Gemini CLI and then went its own way: hooks are
// Claude-shaped (in <project>/.qwen/settings.json, beside its mcpServers),
// every payload carries `transcript_path`, and the chat record is a JSONL
// of ChatRecords whose message bodies are Gemini-style Content — text and
// functionCall parts. Qwen ships its own auto-memory; this adapter lives
// beside it, never assumes a vacuum.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const file = (dir: string) => join(dir, ".qwen", "settings.json");

interface Settings {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(dir: string): Promise<void> {
  const doc = await readJson<Settings>(file(dir));
  doc.mcpServers ??= {};
  doc.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
  await writeJson(file(dir), doc);
}

async function removeMcp(dir: string): Promise<boolean> {
  const doc = await readJson<Settings>(file(dir));
  if (!doc.mcpServers || !oursMcp(doc.mcpServers.memcell)) return false;
  delete doc.mcpServers.memcell;
  await rmIfEmptied(file(dir), doc, "mcpServers");
  return true;
}

const WRITE_TOOLS = new Set(["write_file", "edit", "replace", "notebook_edit"]);

export const qwen: Adapter = {
  name: "qwen",
  get surface() {
    return SURFACE;
  },
  ...ccHookOps("qwen", file, EVENT, { afterInstall: installMcp, alsoRemove: removeMcp }),

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
  },

  // ── read — ChatRecord JSONL, Gemini-shaped parts inside ──────────────────
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as {
        type?: string;
        message?: { role?: string; content?: unknown; parts?: unknown };
      };
      const role = entry.type === "user" ? "user" : entry.type === "assistant" ? "assistant" : null;
      if (!role) return;
      const parts = partsOf(entry.message);
      for (const part of parts) {
        const call = (part as { functionCall?: { name?: string; args?: Record<string, unknown> } })
          .functionCall;
        if (call && WRITE_TOOLS.has(call.name ?? "")) {
          addTouched(touched, pathOf(call.args), payload.cwd);
        }
      }
      const text = parts
        .map((p) =>
          p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "",
        )
        .filter(Boolean)
        .join("\n");
      if (text.trim()) said.push(`${role}: ${text.trim()}`);
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

/** A ChatRecord's message body: Content with `parts`, a bare string, or a
 *  parts array directly — spellings seen across versions, read tolerantly. */
function partsOf(message: { content?: unknown; parts?: unknown } | undefined): unknown[] {
  if (!message) return [];
  if (Array.isArray(message.parts)) return message.parts;
  const content = message.content;
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) return content;
  if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as { parts?: unknown[] }).parts)
  )
    return (content as { parts: unknown[] }).parts;
  return [];
}

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
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
  },
  guard: {
    event: "PreToolUse",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: ["read_file", "ReadFile", "glob", "search_file_content"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["run_shell_command"],
      send: ["run_shell_command"],
    },
  },
};
