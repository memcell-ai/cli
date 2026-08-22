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
