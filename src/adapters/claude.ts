import { unsupported, type Surface } from "./surface.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Moment } from "../loop/moments.js";
import { ccHookOps } from "./cc-hooks.js";
import {
  addTouched,
  emptySession,
  pathOf,
  readJsonlSlice,
  TOUCHED_CAP,
  type Incoming,
  type Session,
} from "./capture.js";
import { MCP_ARGS, MCP_COMMAND, oursMcp, readJson, writeJson, type Adapter } from "./shared.js";

// Claude Code. Hooks go in <project>/.claude/settings.json — the project
// settings file, committable, which Claude Code reads and does not own.
//
// They used to go in settings.local.json because it is gitignored. That is
// true, and it is true for the reason that made it the wrong file: Claude
// Code writes it — permission approvals, /skills — and gitignores what it
// writes. A settings file the host serializes from its own model will drop
// anything a third party added since the session loaded it, silently, and
// the loop then does nothing while every surface still says connected.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

/**
 * What this harness can do, declared — see adapters/surface.ts.
 *
 * Claude Code documents thirty-one events; the loop rides four of them. That
 * is a statement about what memcell asks for, not about what the agent
 * offers, and the difference is written down here so nobody reads one as the
 * other again.
 *
 * `PreToolUse` fires before every individual tool call — its own tools and
 * MCP tools alike — takes a regex matcher on the tool NAME, and reads
 * `hookSpecificOutput.additionalContext` back into the model's context.
 * Exit code 2 refuses the call and shows stderr to the model as the reason.
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
      inject: unsupported("the session is over — there is nobody left to tell"),
    },
  },
  guard: {
    event: "PreToolUse",
    // Alternation on the tool name, which is what its matcher takes.
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    // THIS agent's tools, by the moment each belongs to. The record knows
    // only the five words; which tool is which is knowledge about Claude
    // Code and lives here.
    tools: {
      read: ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookRead"],
      change: ["Write", "Edit", "NotebookEdit"],
      // Bash is every one of change/record/send depending on the command,
      // so it is guarded and the class is decided from the command itself.
      record: ["Bash"],
      send: ["Bash"],
    },
  },
};

const file = (dir: string) => join(dir, ".claude", "settings.json");
/** Where older releases wired. Ours are swept out of here on install. */
const legacy = (dir: string) => [join(dir, ".claude", "settings.local.json")];
// MCP servers live in .mcp.json at the project root — a separate, committable
// file Claude Code reads for exactly this. Our entry is the bridge command
// and nothing else, so committing it is a feature, same as the hooks.
const mcpFile = (dir: string) => join(dir, ".mcp.json");

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(dir: string): Promise<void> {
  const at = mcpFile(dir);
  const doc = await readJson<McpFile>(at);
  doc.mcpServers ??= {};
  // Refresh ours in place; never touch anybody else's server.
  doc.mcpServers.memcell = { type: "stdio", command: MCP_COMMAND, args: MCP_ARGS };
  await writeJson(at, doc);
}

async function removeMcp(dir: string): Promise<boolean> {
  const at = mcpFile(dir);
  const doc = await readJson<McpFile>(at);
  if (!doc.mcpServers || !oursMcp(doc.mcpServers.memcell)) return false;
  delete doc.mcpServers.memcell;
  if (Object.keys(doc.mcpServers).length === 0) delete doc.mcpServers;
  if (Object.keys(doc).length === 0) {
    await rm(at, { force: true });
  } else {
    await writeJson(at, doc);
  }
  return true;
}

const wiring = ccHookOps("claude", file, EVENT, {
  afterInstall: installMcp,
  alsoRemove: removeMcp,
  legacy,
});

export const claude: Adapter = {
  name: "claude",
  surface: SURFACE,
  ...wiring,

  // ── speak — hookSpecificOutput carries the injection ─────────────────────
  speak(moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: EVENT[moment],
        additionalContext: context,
      },
    });
  },

  // Claude Code has a richer refusal than an exit code: a permission
  // decision, with the reason shown to the model rather than to a log.
  refuse(reason: string): string {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
  },

  // ── read — the JSONL transcript the hook is handed ───────────────────────
  // Each line is `{ message: { role, content } }`; content is a string or an
  // array of blocks, and a write shows up as a `tool_use` block naming one
  // of the file tools.
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as { type?: string; message?: { role?: string; content?: unknown } };
      const content = entry.message?.content;
      const role = entry.message?.role ?? entry.type;
      if (!content || (role !== "user" && role !== "assistant")) return;
      if (Array.isArray(content)) {
        for (const block of content as {
          type?: string;
          name?: string;
          input?: Record<string, unknown>;
        }[]) {
          if (block?.type !== "tool_use" || !WRITE_TOOLS.has(block.name ?? "")) continue;
          addTouched(touched, pathOf(block.input), payload.cwd);
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

/** The tools whose use means a file CHANGED. Reads and searches are not
 *  touches — the record is what the agent did to the project, not what it
 *  looked at. */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
