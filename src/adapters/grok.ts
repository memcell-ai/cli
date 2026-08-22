import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
import { MCP_ARGS, MCP_COMMAND, type Adapter } from "./shared.js";

// Grok Build (xAI). Claude-shaped hooks, kept in a dedicated file this
// adapter owns whole — <project>/.grok/hooks/memcell.json — so the nested
// core writes it exactly as it writes a settings block. Injection is
// snake_case `additional_context`; the transcript arrives camelCased as
// `transcriptPath` and is a JSONL of ACP session/update notifications. Its
// MCP registration is TOML (project .grok/config.toml), managed between
// markers like the codex adapter's and for the same reason: no TOML parser,
// no ability to rewrite the person's own tables.
//
// Grok's hooks are trust-gated on its side — after installing, a person
// approves them in-product once. Grok also ships an experimental built-in
// memory; this adapter lives beside it.

const EVENT: Record<Moment, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  "turn-end": "Stop",
  "session-end": "SessionEnd",
};

const hooksFile = (dir: string) => join(dir, ".grok", "hooks", "memcell.json");
const tomlFile = (dir: string) => join(dir, ".grok", "config.toml");

const BEGIN = "# memcell:begin — managed block, removed whole by `memcell hook remove`";
const END = "# memcell:end";

const block = (): string =>
  [
    BEGIN,
    `[mcp_servers.memcell]`,
    `command = "${MCP_COMMAND}"`,
    `args = ${JSON.stringify(MCP_ARGS)}`,
    END,
  ].join("\n");

function stripped(text: string): string {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END, begin);
  if (end === -1) return text;
  return `${text.slice(0, begin)}${text.slice(end + END.length)}`.replace(/\n{3,}/g, "\n\n");
}

async function installMcp(dir: string): Promise<void> {
  const at = tomlFile(dir);
  const current = await readFile(at, "utf8").catch(() => "");
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, `${stripped(current).trimEnd()}\n\n${block()}\n`.replace(/^\n+/, ""));
}

async function removeMcp(dir: string): Promise<boolean> {
  const at = tomlFile(dir);
  const current = await readFile(at, "utf8").catch(() => null);
  if (current === null || !current.includes(BEGIN)) return false;
  await writeFile(at, stripped(current));
  return true;
}

const WRITE_TOOLS = new Set(["search_replace", "write", "apply_patch", "edit_file", "write_file"]);

export const grok: Adapter = {
  name: "grok",
  ...ccHookOps("grok", hooksFile, EVENT, { afterInstall: installMcp, alsoRemove: removeMcp }),

  speak(_moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({ additional_context: context });
  },

  // ── read — the ACP update stream its hooks name ──────────────────────────
  // Each line is a session/update notification; the update's
  // `sessionUpdate` kind says what it is: message chunks carry the words,
  // tool_call carries the rawInput whose path names the write.
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as { params?: { update?: Record<string, unknown> } } & {
        update?: Record<string, unknown>;
      };
      const update = entry.params?.update ?? entry.update;
      if (!update) return;
      const kind = update.sessionUpdate as string | undefined;
      if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
        const role = kind === "user_message_chunk" ? "user" : "assistant";
        const content = update.content as { text?: string } | string | undefined;
        const text = typeof content === "string" ? content : (content?.text ?? "");
        if (text.trim()) said.push(`${role}: ${text.trim()}`);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const name = String(update.title ?? update.toolName ?? update.name ?? "");
        const input = update.rawInput as Record<string, unknown> | string | undefined;
        if (
          name === "apply_patch" ||
          (typeof input === "string" && input.includes("*** Begin Patch"))
        ) {
          const patch =
            typeof input === "string" ? input : String((input as { input?: unknown })?.input ?? "");
          for (const f of patchPaths(patch)) addTouched(touched, f, payload.cwd);
        } else if (WRITE_TOOLS.has(name) && typeof input === "object") {
          addTouched(touched, pathOf(input), payload.cwd);
        }
      }
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};
