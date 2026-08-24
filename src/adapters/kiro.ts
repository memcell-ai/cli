import type { Surface } from "./surface.js";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
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
  oursMcp,
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
  type Wiring,
  missingMoments,
  staleText,
} from "./shared.js";

// AWS Kiro CLI (the rebranded Amazon Q Developer CLI). Two things make it
// its own file rather than a cc-hooks consumer:
//
//  1. Hooks live INSIDE an agent definition's `hooks` block, not a
//     top-level events map — and they fire only for the AGENT that is
//     active. So memcell owns a dedicated agent file, .kiro/agents/
//     memcell.json, carrying just its hooks; a person runs it with
//     `kiro --agent memcell`. Owned whole, removed whole, like codex's
//     managed block. Kiro's stable channel has exactly FIVE triggers and
//     no session-end, so that moment is honestly unwired.
//
//  2. Injection is RAW STDOUT TEXT: on agentSpawn / userPromptSubmit, a
//     hook's stdout is added to the agent's context verbatim, not parsed
//     as JSON. So `speak` returns the context string itself.
//
// The record is JSONL at ~/.kiro/sessions/cli/<session-id>.jsonl — Prompt
// / AssistantMessage / ToolResults lines, each `{ version, kind, data }`.
// Verified against a real captured Kiro session; the write tool is `write`
// (new engine) or `fs_write` (classic), path in `input.path`.

// memcell's four moments onto Kiro's five triggers. session-end has no
// trigger on the stable channel — the wiring says so.
const EVENT: Record<Moment, string> = {
  "session-start": "agentSpawn",
  "prompt-submit": "userPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "stop",
  "session-end": "—",
};

const agentFile = (dir: string) => join(dir, ".kiro", "agents", "memcell.json");
const mcpFile = (dir: string) => join(dir, ".kiro", "settings", "mcp.json");

interface AgentFile {
  name?: string;
  description?: string;
  hooks?: Record<string, { command: string; timeout_ms?: number; matcher?: string }[]>;
  [k: string]: unknown;
}

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

const WRITE_TOOLS = new Set(["write", "fs_write", "fsWrite"]);

export const kiro: Adapter = {
  name: "kiro",
  get surface() {
    return SURFACE;
  },

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    const files = [agentFile(resolve(dir)), mcpFile(resolve(dir))];
    // Wiring of the right shape that predates a moment — what every
    // upgrade adding one leaves behind. Caught here so the first hook
    // after an upgrade carries itself forward and nobody is told to.
    return (await staleText(files)) || missingMoments(files, Object.values(EVENT));
  },

  async install(projectDir: string): Promise<string> {
    const at = agentFile(resolve(projectDir));
    const doc = await readJson<AgentFile>(at);
    doc.name ??= "memcell";
    doc.description ??= "Recall and remember through memcell — run with `kiro --agent memcell`.";
    doc.hooks ??= {};
    // Only the three triggers Kiro fires that memcell has a moment for.
    for (const moment of MOMENTS) {
      if (EVENT[moment] === "—") continue;
      const entries = (doc.hooks[EVENT[moment]] ??= []);
      const command = hookCommand(moment, "kiro");
      let held = false;
      for (const entry of entries) {
        if (hookMatches(entry.command, moment, "kiro")) {
          entry.command = command;
          held = true;
        }
      }
      if (!held) entries.push({ command, timeout_ms: 30000 });
    }
    await writeJson(at, doc);

    const mcpAt = mcpFile(resolve(projectDir));
    const mcp = await readJson<McpFile>(mcpAt);
    mcp.mcpServers ??= {};
    mcp.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
    await writeJson(mcpAt, mcp);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = agentFile(resolve(projectDir));
    let removed = false;

    const mcpAt = mcpFile(resolve(projectDir));
    const mcp = await readJson<McpFile>(mcpAt);
    if (mcp.mcpServers && oursMcp(mcp.mcpServers.memcell)) {
      delete mcp.mcpServers.memcell;
      await rmIfEmptied(mcpAt, mcp, "mcpServers");
      removed = true;
    }

    // Our agent file is ours whole — but only if it still is ours. A file a
    // person has taken over past its purpose is left for them.
    const doc = await readJson<AgentFile>(at);
    if (doc.name === "memcell") {
      await rm(at, { force: true });
      removed = true;
    }
    return removed ? at : null;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const doc = await readJson<AgentFile>(agentFile(resolve(projectDir)));
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok:
        EVENT[moment] === "—"
          ? false
          : Boolean(
              doc.hooks?.[EVENT[moment]]?.some((h) => hookMatches(h.command, moment, "kiro")),
            ),
    }));
  },

  // ── speak — RAW context text; Kiro adds stdout to context verbatim ───────
  speak(_moment: Moment, context: string | null): string | null {
    return context && context.trim() ? context : null;
  },

  // ── read — the session JSONL, Prompt / AssistantMessage / ToolResults ────
  async read(payload: Incoming, from: number): Promise<Session> {
    const sid = payload.session_id ?? payload.sessionId;
    if (!sid) return emptySession(from);
    const home = process.env.KIRO_HOME ?? join(homedir(), ".kiro");
    const path = join(home, "sessions", "cli", `${sid}.jsonl`);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as { kind?: string; data?: { content?: unknown } };
      const blocks = Array.isArray(entry.data?.content) ? entry.data.content : [];
      if (entry.kind === "Prompt") {
        const text = blockText(blocks);
        if (text.trim()) said.push(`user: ${text.trim()}`);
      } else if (entry.kind === "AssistantMessage") {
        for (const b of blocks as {
          kind?: string;
          data?: { name?: string; input?: Record<string, unknown> };
        }[]) {
          if (b?.kind === "toolUse" && WRITE_TOOLS.has(b.data?.name ?? "")) {
            addTouched(touched, pathOf(b.data?.input), payload.cwd);
          }
        }
        const text = blockText(blocks);
        if (text.trim()) said.push(`assistant: ${text.trim()}`);
      }
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

/** The words of a Kiro content-block array — the `text` blocks, dropping
 *  toolUse / toolResult / image. */
function blockText(blocks: unknown[]): string {
  return blocks
    .filter(
      (b): b is { data: string } =>
        (b as { kind?: string })?.kind === "text" &&
        typeof (b as { data?: unknown }).data === "string",
    )
    .map((b) => b.data)
    .join("\n");
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
      event: "agentSpawn",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "prompt-submit": {
      event: "userPromptSubmit",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "before-act": {
      event: "PreToolUse",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "turn-end": {
      event: "stop",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "session-end": {
      event: "—",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
  },
  guard: {
    event: "PreToolUse",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: ["fs_read", "read"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["execute_bash", "shell"],
      send: ["execute_bash", "shell"],
    },
  },
};
