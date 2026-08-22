import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { hookCommand, hookMatches, MOMENTS, type Moment } from "../loop/moments.js";
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
import {
  MCP_ARGS,
  MCP_COMMAND,
  exists,
  oursMcp,
  readJson,
  writeJson,
  type Adapter,
  type Wiring,
  staleText,
} from "./shared.js";

// GitHub Copilot CLI. A whole file of our own under .github/hooks/, because
// copilot reads every *.json there additively — so removing is `rm`, and
// nobody's hooks share a file with ours.
//
// The event choice is the barb: `userPromptSubmitted` looks right and
// silently drops a config-file hook's output. `userPromptTransformed` is the
// one that works, and its reply REPLACES the prompt — which is why the
// dialect echoes the original back.

const EVENT: Record<Moment, string> = {
  "session-start": "sessionStart",
  "prompt-submit": "userPromptTransformed",
  "turn-end": "agentStop",
  "session-end": "sessionEnd",
};

const file = (dir: string) => join(dir, ".github", "hooks", "memcell.json");
// MCP servers live in .github/mcp.json — a SHARED file others may hold
// servers in, so it gets the merge discipline the hooks file avoids by
// being wholly ours.
const mcpFile = (dir: string) => join(dir, ".github", "mcp.json");

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function installMcp(dir: string): Promise<void> {
  const at = mcpFile(dir);
  const doc = await readJson<McpFile>(at);
  doc.mcpServers ??= {};
  doc.mcpServers.memcell = { type: "local", command: MCP_COMMAND, args: MCP_ARGS, tools: ["*"] };
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

export const copilot: Adapter = {
  name: "copilot",

  /** An older release's shape — a path or an --agent in the wiring. */
  async stale(dir: string): Promise<boolean> {
    return staleText([join(resolve(dir), ".github", "hooks", "memcell.json")]);
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    await writeJson(at, {
      version: 1,
      hooks: Object.fromEntries(
        MOMENTS.map((moment) => [
          EVENT[moment],
          [{ type: "command", bash: hookCommand(moment, "copilot"), timeoutSec: 30 }],
        ]),
      ),
    });
    await installMcp(resolve(projectDir));
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    const unwired = await removeMcp(resolve(projectDir));
    if (!(await exists(at))) return unwired ? at : null;
    await rm(at, { force: true });
    return at;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const held = await readJson<{ hooks?: Record<string, { bash?: string }[]> }>(
      file(resolve(projectDir)),
    );
    return MOMENTS.map((moment) => ({
      moment,
      event: EVENT[moment],
      ok: Boolean(
        held.hooks?.[EVENT[moment]]?.some((h) => hookMatches(h.bash ?? "", moment, "copilot")),
      ),
    }));
  },

  // ── speak — the barb this dialect earns its file for ─────────────────────
  // Copilot's usable prompt event REPLACES the prompt, so the original must
  // be echoed back or the hook deletes what the person typed. Nothing to
  // echo means say nothing — a prompt-deleting reply is worse than a
  // dropped injection.
  speak(
    _moment: Moment,
    context: string | null,
    heard: { prompt?: string; transformedPrompt?: string },
  ): string | null {
    if (!context) return null;
    const original = heard.transformedPrompt ?? heard.prompt ?? "";
    if (!original) return null;
    return JSON.stringify({ modifiedTransformedPrompt: `${context}\n\n${original}` });
  },

  // ── read — the per-session event log copilot itself writes ───────────────
  // `$COPILOT_HOME/session-state/<session-id>/events.jsonl`, one event per
  // line. Text is `user.message` / `assistant.message` (data.content); a
  // write is a `tool.execution_start` for one of the file tools — the path
  // in `data.arguments.path`, or the marker lines of an apply_patch
  // envelope. Ephemeral events are not persisted, so what is on disk is the
  // real record.
  async read(payload: Incoming, from: number): Promise<Session> {
    const sid = payload.session_id ?? payload.sessionId;
    if (!sid) return emptySession(from);
    const home = process.env.COPILOT_HOME ?? join(homedir(), ".copilot");
    const path = join(home, "session-state", sid, "events.jsonl");
    const said: string[] = [];
    const touched: string[] = [];
    const read = await readJsonlSlice(path, from, (raw) => {
      const entry = raw as { type?: string; data?: Record<string, unknown> };
      const data = entry.data ?? {};
      if (entry.type === "user.message" || entry.type === "assistant.message") {
        const role = entry.type === "user.message" ? "user" : "assistant";
        const text = String(data.content ?? "");
        if (text.trim()) said.push(`${role}: ${text.trim()}`);
      } else if (entry.type === "tool.execution_start") {
        const tool = String(data.toolName ?? "");
        if (!WRITE_TOOLS.has(tool)) return;
        const args = data.arguments as Record<string, unknown> | string | undefined;
        if (tool === "apply_patch") {
          for (const file of patchPaths(typeof args === "string" ? args : ""))
            addTouched(touched, file, payload.cwd);
          return;
        }
        if (typeof args !== "object") return;
        if (tool === "str_replace_editor" && (args as { command?: string }).command === "view")
          return;
        addTouched(touched, pathOf(args as Record<string, unknown>), payload.cwd);
      }
    });
    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

/** Copilot's write-capable tools. A str_replace_editor VIEW is a read and
 *  does not travel. Shell writes surface only as command strings and are
 *  honestly absent. */
const WRITE_TOOLS = new Set(["create", "edit", "str_replace_editor", "apply_patch"]);
