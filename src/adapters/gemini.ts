import type { Surface } from "./surface.js";
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
  ours,
  oursMcp,
  readJson,
  writeJson,
  type Adapter,
  type Wiring,
  missingMoments,
  staleText,
} from "./shared.js";

// Gemini CLI. Hooks AND the MCP registration go in
// <project>/.gemini/settings.json — its mcpServers infers stdio from a bare
// `command`, no type discriminator.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "BeforeAgent",
  "before-act": "BeforeTool",
  "turn-end": "AfterAgent",
  "session-end": "SessionEnd",
};

interface Entry {
  matcher?: string;
  hooks?: { name?: string; type: string; command: string; timeout?: number }[];
}
interface Settings {
  hooks?: Record<string, Entry[]>;
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

const file = (dir: string) => join(dir, ".gemini", "settings.json");

export const gemini: Adapter = {
  name: "gemini",
  get surface() {
    return SURFACE;
  },

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    const files = [join(resolve(dir), ".gemini", "settings.json")];
    // Wiring of the right shape that predates a moment — what every
    // upgrade adding one leaves behind. Caught here so the first hook
    // after an upgrade carries itself forward and nobody is told to.
    return (await staleText(files)) || missingMoments(files, Object.values(EVENT));
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const settings = await readJson<Settings>(at);
    settings.hooks ??= {};
    for (const moment of MOMENTS) {
      const entries = (settings.hooks[EVENT[moment]] ??= []);
      const command = hookCommand(moment, "gemini");
      // Merge never clobbers OTHER entries; our own is refreshed in place. A
      // re-connect mints a new agent identity, and a hook left carrying the
      // old one reports a dead agent on every firing.
      let held = false;
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (hookMatches(h.command, moment, "gemini")) {
            h.command = command;
            held = true;
          }
        }
      }
      if (!held) {
        entries.push({
          matcher: "*",
          hooks: [{ name: "memcell", type: "command", command, timeout: 30000 }],
        });
      }
    }
    settings.mcpServers ??= {};
    settings.mcpServers.memcell = { command: MCP_COMMAND, args: MCP_ARGS };
    await writeJson(at, settings);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    const settings = await readJson<Settings>(at);
    let changed = false;
    if (settings.mcpServers && oursMcp(settings.mcpServers.memcell)) {
      delete settings.mcpServers.memcell;
      if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      changed = true;
    }
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      for (const entry of entries) {
        const before = entry.hooks?.length ?? 0;
        if (entry.hooks) entry.hooks = entry.hooks.filter((h) => !ours(h.command));
        if ((entry.hooks?.length ?? 0) !== before) changed = true;
      }
      settings.hooks![event] = entries.filter((e) => (e.hooks?.length ?? 0) > 0);
      if (settings.hooks![event].length === 0) delete settings.hooks![event];
    }
    if (!changed) return null;
    await writeJson(at, settings);
    return at;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const settings = await readJson<Settings>(file(resolve(projectDir)));
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: Boolean(
        settings.hooks?.[EVENT[moment]]?.some((e) =>
          e.hooks?.some((h) => hookMatches(h.command, moment, "gemini")),
        ),
      ),
    }));
  },

  // ── speak — additionalContext, no event name required ────────────────────
  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ hookSpecificOutput: { additionalContext: context } });
  },

  // ── read — the JSONL transcript the hook payload names ───────────────────
  // Line 1 is session metadata; later lines are MessageRecords. Text lives
  // in `content` (a genai PartListUnion); writes live in a separate
  // `toolCalls` array on the assistant's messages, named write_file/replace
  // with the path in `args.file_path`.
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const rec = raw as {
        type?: string;
        content?: unknown;
        toolCalls?: { name?: string; args?: Record<string, unknown> }[];
      };
      // Metadata and control lines ($set / $rewindTo) carry no role.
      const role = rec.type === "user" ? "user" : rec.type === "gemini" ? "assistant" : null;
      if (!role) return;
      for (const call of rec.toolCalls ?? []) {
        if (WRITE_TOOLS.has(call.name ?? "")) addTouched(touched, pathOf(call.args), payload.cwd);
      }
      const text = partText(rec.content);
      if (text.trim()) said.push(`${role}: ${text.trim()}`);
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

/** Gemini's write tools: legacy `write_file` and `replace`, plus modern
 *  variants like `write_to_file`, `replace_file_content`, and `edit_file`.
 *  `run_shell_command` writes are invisible to argument parsing and
 *  honestly absent. */
const WRITE_TOOLS = new Set([
  "write_file",
  "replace",
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "Write",
  "Edit",
]);

/** The text of a genai PartListUnion — the plain words, dropping the
 *  functionCall / functionResponse parts that carry no prose. */
function partText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : content ? [content] : [];
  return parts
    .map((p) =>
      p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "",
    )
    .filter(Boolean)
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
      event: "SessionStart",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "prompt-submit": {
      event: "BeforeAgent",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "before-act": {
      event: "BeforeTool",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "turn-end": {
      event: "AfterAgent",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
    "session-end": {
      event: "SessionEnd",
      inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    },
  },
  guard: {
    event: "BeforeTool",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: ["read_file", "read_many_files", "glob", "search_file_content", "view_file"],
      change: [...WRITE_TOOLS],
      // One shell is record AND send; which one is decided from the command.
      record: ["run_shell_command", "run_command"],
      send: ["run_shell_command", "run_command"],
    },
  },
};
