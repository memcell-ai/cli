import type { Surface } from "./surface.js";
import { homedir } from "node:os";
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
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
  oursMcp,
} from "./shared.js";

// Muse Code (Meta). Claude-shaped hooks in <project>/.muse/hooks.json —
// its own harness verified the hookSpecificOutput contract — and a
// transcript path on every hook's stdin. The MCP registration is the one
// user-level write this adapter makes: Muse reads `mcp_servers` only from
// ~/.config/muse/settings.json (the codex adapter's precedent — some
// agents simply have no project-side MCP file). Our entry is refreshed in
// place and removed exactly, nothing else in the file is touched.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const file = (dir: string) => join(dir, ".muse", "hooks.json");
const settingsFile = () =>
  join(process.env.MUSE_CONFIG_DIR ?? join(homedir(), ".config", "muse"), "settings.json");

interface Settings {
  schema_version?: number;
  mcp_servers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(): Promise<void> {
  const at = settingsFile();
  const doc = await readJson<Settings>(at);
  doc.schema_version ??= 1;
  doc.mcp_servers ??= {};
  doc.mcp_servers.memcell = { transport: "stdio", command: MCP_COMMAND, args: MCP_ARGS };
  await writeJson(at, doc);
}

async function removeMcp(): Promise<boolean> {
  const at = settingsFile();
  const doc = await readJson<Settings>(at);
  const held = doc.mcp_servers?.memcell as { command?: string } | undefined;
  if (!oursMcp(held)) return false;
  delete doc.mcp_servers!.memcell;
  if (Object.keys(doc.mcp_servers!).length === 0) delete doc.mcp_servers;
  // schema_version alone is a husk of our own making.
  if (Object.keys(doc).length === 1 && "schema_version" in doc) delete doc.schema_version;
  await rmIfEmptied(at, doc, "mcp_servers");
  return true;
}

const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch", "delete_file"]);

export const muse: Adapter = {
  name: "muse",
  get surface() {
    return SURFACE;
  },
  ...ccHookOps("muse", file, EVENT, {
    afterInstall: () => installMcp(),
    alsoRemove: () => removeMcp(),
  }),

  speak(moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: EVENT[moment], additionalContext: context },
    });
  },

  // ── read — the run-event JSONL its hooks name ────────────────────────────
  // Each line wraps a run event: `payload.event.kind` is `started` (the
  // user's prompt), `assistant_message_committed` (the reply), or
  // `assistant_tool_calls_committed` (the tools, with their args). Verified
  // against the live binary's own session log shape.
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as {
        payload?: { kind?: string; event?: Record<string, unknown> };
      };
      const event = entry.payload?.event;
      if (!event) return;
      const kind = event.kind as string | undefined;
      if (kind === "started" && typeof event.prompt === "string" && event.prompt.trim()) {
        said.push(`user: ${event.prompt.trim()}`);
      } else if (
        kind === "assistant_message_committed" &&
        typeof event.text === "string" &&
        event.text.trim()
      ) {
        said.push(`assistant: ${event.text.trim()}`);
      } else if (kind === "assistant_tool_calls_committed") {
        for (const call of (event.tool_calls as { name?: string; args?: unknown }[] | undefined) ??
          []) {
          if (!WRITE_TOOLS.has(call.name ?? "")) continue;
          const args = call.args as Record<string, unknown> | string | undefined;
          if (call.name === "apply_patch") {
            const patch =
              typeof args === "string" ? args : String((args as { input?: unknown })?.input ?? "");
            for (const f of patchPaths(patch)) addTouched(touched, f, payload.cwd);
          } else if (typeof args === "object") {
            addTouched(touched, pathOf(args), payload.cwd);
          }
        }
      }
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
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
      read: ["read_file", "grep", "glob"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["run_shell_command", "bash"],
      send: ["run_shell_command", "bash"],
    },
  },
};
