import type { Surface } from "./surface.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

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
  readJson,
  rmIfEmptied,
  writeJson,
  type Adapter,
  type Wiring,
  missingMoments,
  staleText,
} from "./shared.js";

// Goose (Block / Linux Foundation).
// Hooks live in <project>/.goose/hooks.json, with additionalContext for
// injection, exit-code 2 or JSON deny for refusal, and MCP configured
// in ~/.config/goose/config.yaml or <project>/.goosehints.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "before-act": "PreToolUse",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

interface HookEntry {
  type?: string;
  command: string;
  timeout?: number;
}

interface HooksFile {
  version?: number;
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

const file = (dir: string) => join(dir, ".goose", "hooks.json");
const configDir = () => join(homedir(), ".config", "goose");
const configFile = () => join(configDir(), "config.yaml");

const WRITE_TOOLS = new Set([
  "developer__write_file",
  "developer__edit_file",
  "developer__patch_file",
  "write_file",
  "edit_file",
  "write",
  "edit",
  "apply_patch",
]);

const BEGIN_MCP = "# memcell:begin — managed block, removed whole by memcell hook remove";
const END_MCP = "# memcell:end";

const mcpBlock = (): string =>
  [
    BEGIN_MCP,
    "extensions:",
    "  memcell:",
    "    enabled: true",
    "    transport:",
    "      type: stdio",
    `      command: ${MCP_COMMAND}`,
    `      args: ${JSON.stringify(MCP_ARGS)}`,
    END_MCP,
  ].join("\n");

async function installConfig(): Promise<void> {
  const at = configFile();
  const text = await readFile(at, "utf8").catch(() => "");
  if (text.includes("memcell")) return;
  const merged = text.trim() ? `${text.trim()}\n\n${mcpBlock()}\n` : `${mcpBlock()}\n`;
  await writeFile(at, merged, "utf8").catch(() => undefined);
}

async function removeConfig(): Promise<boolean> {
  const at = configFile();
  const text = await readFile(at, "utf8").catch(() => "");
  const begin = text.indexOf(BEGIN_MCP);
  if (begin === -1) return false;
  const end = text.indexOf(END_MCP, begin);
  if (end === -1) return false;
  const next = `${text.slice(0, begin)}${text.slice(end + END_MCP.length)}`.replace(
    /\n{3,}/g,
    "\n\n",
  );
  await writeFile(at, next, "utf8").catch(() => undefined);
  return true;
}

export const goose: Adapter = {
  name: "goose",
  get surface() {
    return SURFACE;
  },

  async stale(dir: string): Promise<boolean> {
    const files = [file(resolve(dir))];
    return (await staleText(files)) || missingMoments(files, Object.values(EVENT));
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const doc = await readJson<HooksFile>(at);
    doc.version ??= 1;
    doc.hooks ??= {};

    for (const moment of MOMENTS) {
      const entries = (doc.hooks[EVENT[moment]] ??= []);
      const command = hookCommand(moment, "goose");
      let held = false;
      for (const entry of entries) {
        if (hookMatches(entry.command, moment, "goose")) {
          entry.command = command;
          held = true;
        }
      }
      if (!held) {
        entries.push({ type: "command", command, timeout: 30 });
      }
    }

    await writeJson(at, doc);
    await installConfig().catch(() => undefined);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    const doc = await readJson<HooksFile>(at);
    let changed = false;

    for (const [event, entries] of Object.entries(doc.hooks ?? {})) {
      const filtered = entries.filter(
        (e) => !hookMatches(e.command, "prompt-submit", "goose") && !e.command.includes("memcell"),
      );
      if (filtered.length !== entries.length) {
        changed = true;
        if (doc.hooks) doc.hooks[event] = filtered;
      }
      if (doc.hooks?.[event]?.length === 0) delete doc.hooks[event];
    }

    await removeConfig().catch(() => undefined);

    if (!changed) return null;
    await rmIfEmptied(at, doc, "hooks");
    return at;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const doc = await readJson<HooksFile>(file(resolve(projectDir)));
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: Boolean(doc.hooks?.[EVENT[moment]]?.some((e) => hookMatches(e.command, moment, "goose"))),
    }));
  },

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      hookSpecificOutput: { additionalContext: context },
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
        role?: string;
        content?: unknown;
        toolCalls?: { name?: string; args?: Record<string, unknown> }[];
      };
      if (rec.role && rec.content) {
        const text = String(rec.content);
        if (text.trim()) said.push(`${rec.role}: ${text.trim()}`);
      }
      for (const call of rec.toolCalls ?? []) {
        if (WRITE_TOOLS.has(call.name ?? "")) {
          addTouched(touched, pathOf(call.args), payload.cwd);
        }
      }
    });

    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

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
      inject: { unsupported: "the session is over — there is nobody left to tell" },
    },
  },
  guard: {
    event: "PreToolUse",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : undefined),
    inject: { via: "json", path: "hookSpecificOutput.additionalContext" },
    refuse: { via: "exit-code", code: 2 },
    tools: {
      read: [
        "developer__read_file",
        "developer__list_dir",
        "developer__search_files",
        "read_file",
        "view_file",
      ],
      change: [...WRITE_TOOLS],
      record: ["developer__shell_command", "shell_command", "Bash"],
      send: ["developer__shell_command", "shell_command", "Bash"],
    },
  },
};
