import type { Surface } from "./surface.js";
import { unsupported } from "./surface.js";
import { join, resolve } from "node:path";

import { hookCommand, hookMatches, type LifecycleHook } from "../loop/moments.js";
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
  missingMoments,
  staleText,
} from "./shared.js";

// Cursor CLI. Hooks go in <project>/.cursor/hooks.json — its own flat shape
// (`{ version: 1, hooks: { <event>: [{ command }] } }`), not the nested
// Claude one, though its payloads and tool names are Claude-compatible and
// it hands `transcript_path` on every firing. The MCP registration rides
// <project>/.cursor/mcp.json, the same file the editor reads.
//
// Wired against Cursor's verified event subset:
// - sessionStart: initializes session context
// - beforeSubmitPrompt: prompt gating
// - preToolUse & subagentStart: pre-action permission evaluation
// - postToolUse & postToolUseFailure: post-action context injection & failure recovery
// - stop & sessionEnd: turn/session termination capture

const EVENT_HOOKS: { event: string; moment: LifecycleHook }[] = [
  { event: "sessionStart", moment: "session-start" },
  { event: "beforeSubmitPrompt", moment: "prompt-submit" },
  { event: "preToolUse", moment: "before-act" },
  { event: "subagentStart", moment: "before-act" },
  { event: "postToolUse", moment: "after-act" },
  { event: "postToolUseFailure", moment: "after-act" },
  { event: "stop", moment: "turn-end" },
  { event: "sessionEnd", moment: "session-end" },
];

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
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "write", "edit", "Delete", "delete"]);

export const cursor: Adapter = {
  name: "cursor",
  get surface() {
    return SURFACE;
  },

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    const files = [join(resolve(dir), ".cursor", "hooks.json")];
    // Wiring of the right shape that predates a moment — what every
    // upgrade adding one leaves behind. Caught here so the first hook
    // after an upgrade carries itself forward and nobody is told to.
    return (
      (await staleText(files)) ||
      (await missingMoments(
        files,
        EVENT_HOOKS.map((e) => e.event),
      ))
    );
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const held = await readJson<HooksFile>(at);
    held.version ??= 1;
    held.hooks ??= {};
    for (const { event, moment } of EVENT_HOOKS) {
      const entries = (held.hooks[event] ??= []);
      const command = hookCommand(moment, "cursor");
      let refreshed = false;
      const kept: { command: string }[] = [];
      for (const entry of entries) {
        if (hookMatches(entry.command, moment, "cursor")) {
          if (!refreshed) {
            entry.command = command;
            kept.push(entry);
            refreshed = true;
          }
        } else {
          kept.push(entry);
        }
      }
      if (!refreshed) kept.push({ command });
      held.hooks[event] = kept;
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
    return EVENT_HOOKS.map(({ event, moment }) => ({
      moment,
      event,
      ok: Boolean(held.hooks?.[event]?.some((e) => hookMatches(e.command, moment, "cursor"))),
    }));
  },

  // ── speak — snake_case, cursor's own field ────────────────────────────────
  speak(moment: LifecycleHook, context: string | null): string | null {
    if (moment === "before-act") {
      // Permission hooks (preToolUse, subagentStart): explicit allow response
      return JSON.stringify({ permission: "allow" });
    }
    if (moment === "after-act" || moment === "session-start") {
      // Context-accepting hooks (postToolUse, postToolUseFailure, sessionStart)
      if (!context) return null;
      return JSON.stringify({ additional_context: context });
    }
    return null;
  },

  // ── refuse — structured denial for permission hooks ───────────────────────
  refuse(reason: string): string {
    return JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    });
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
      const content = entry.message?.content ?? (entry as { content?: unknown }).content;
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
 * rather than a directive shown where it does not apply.
 */
export const SURFACE: Surface = {
  moments: {
    "session-start": {
      event: "sessionStart",
      inject: { via: "json", path: "additional_context" },
    },
    "prompt-submit": {
      event: "beforeSubmitPrompt",
      inject: unsupported(
        "Cursor beforeSubmitPrompt hook supports prompt gating but not context injection",
      ),
    },
    "before-act": {
      event: "preToolUse,subagentStart",
      inject: unsupported(
        "Cursor preToolUse and subagentStart hooks control permission but do not inject context",
      ),
    },
    "after-act": {
      event: "postToolUse,postToolUseFailure",
      inject: { via: "json", path: "additional_context" },
    },
    "turn-end": {
      event: "stop",
      inject: unsupported("Cursor stop hook accepts followup_message but not injected context"),
    },
    "session-end": {
      event: "sessionEnd",
      inject: unsupported("the session is over — Cursor sessionEnd is fire-and-forget"),
    },
  },
  guard: {
    event: "preToolUse,subagentStart",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: unsupported(
      "Cursor preToolUse and subagentStart hooks control permission but do not inject context",
    ),
    refuse: { via: "json", path: "permission", deny: "deny" },
    tools: {
      read: ["Read", "TabRead", "Grep", "explore"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["Shell", "shell"],
      send: ["Shell", "shell", "subagent", "explore", "Task", "task"],
    },
  },
};
