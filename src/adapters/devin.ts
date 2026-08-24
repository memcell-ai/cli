import type { Surface } from "./surface.js";
import { join } from "node:path";

import type { Moment } from "../loop/moments.js";
import { emptySession, type Incoming, type Session } from "./capture.js";
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

// Devin CLI / Devin Local (Cognition — where Windsurf's Cascade went).
// Claude-shaped hooks whose file IS the events map — <project>/
// .devin/hooks.v1.json — with hookSpecificOutput.additionalContext for
// injection, and the MCP registration in <project>/.devin/mcp_config.json.
//
// CAPTURE IS HONESTLY ABSENT for now: Devin Local's on-disk conversation
// store is unverified (the Rust rewrite documents no format, and hooks-era
// transcript delivery is not yet pinned), so `read` returns an empty
// session rather than a guess. The moment its record is verified, the
// reader lands here and nothing else moves. Notably: Devin Local dropped
// its predecessor's persistent memories outright — recall injection is the
// whole point of wiring it.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const file = (dir: string) => join(dir, ".devin", "hooks.v1.json");
const mcpFile = (dir: string) => join(dir, ".devin", "mcp_config.json");

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

export const devin: Adapter = {
  name: "devin",
  get surface() {
    return SURFACE;
  },
  ...ccHookOps("devin", file, EVENT, {
    afterInstall: installMcp,
    alsoRemove: removeMcp,
    shape: "bare",
  }),

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
  },

  async read(_payload: Incoming, from: number): Promise<Session> {
    // No verified record to read — an empty session is the honest answer,
    // and the recall leg still serves on every hook. See the note above.
    return emptySession(from);
  },
};

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
      read: ["read", "glob", "grep", "notebook_read", "mcp_read_resource"],
      change: ["write", "edit", "apply_patch", "notebook_edit"],
      // One shell is record AND send; which one is decided from the command.
      record: ["exec"],
      send: ["exec"],
    },
  },
};
