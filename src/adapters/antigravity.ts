import type { Surface } from "./surface.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { hookCommand, hookMatches, MOMENTS, type Moment } from "../loop/moments.js";
import {
  addTouched,
  emptySession,
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

// Google Antigravity (AGY).
//
// Hooks live in <project>/.agents/hooks.json under a dedicated named hook
// object — `{"memcell": {"PreInvocation": [...], "PreToolUse": [...]}}`.
// Global MCP server registration goes into ~/.gemini/config/mcp_config.json
// with stdio transport.
//
// Injection outputs `injectSteps` with an ephemeral system message; refusal
// returns `{"decision": "deny", "reason": ...}`.
// The session transcript is read from JSONL carrying step_index, type, role,
// content, and tool_calls.

const EVENT: Record<Moment, string> = {
  "session-start": "PreInvocation",
  "prompt-submit": "PreInvocation",
  "before-act": "PreToolUse",
  "turn-end": "PostInvocation",
  "session-end": "Stop",
};

interface Handler {
  type?: string;
  command: string;
  timeout?: number;
}

interface GroupedEntry {
  matcher?: string;
  hooks?: Handler[];
}

interface HookSpec {
  enabled?: boolean;
  PreInvocation?: Handler[];
  PreToolUse?: GroupedEntry[];
  PostInvocation?: Handler[];
  PostToolUse?: GroupedEntry[];
  Stop?: Handler[];
}

type HooksConfig = Record<string, HookSpec>;

interface McpFile {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

const file = (dir: string) => join(dir, ".agents", "hooks.json");
const mcpFile = () => join(homedir(), ".gemini", "config", "mcp_config.json");

const WRITE_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "Write",
  "Edit",
  "write_file",
  "replace",
]);

async function installMcp(): Promise<void> {
  const at = mcpFile();
  const doc = await readJson<McpFile>(at);
  doc.mcpServers ??= {};
  const args = [...MCP_ARGS, "--agent", "antigravity"];
  doc.mcpServers.memcell = { command: MCP_COMMAND, args };
  await writeJson(at, doc);
}

async function removeMcp(): Promise<boolean> {
  const at = mcpFile();
  const doc = await readJson<McpFile>(at);
  if (!doc.mcpServers || !oursMcp(doc.mcpServers.memcell)) return false;
  delete doc.mcpServers.memcell;
  await rmIfEmptied(at, doc, "mcpServers");
  return true;
}

export const antigravity: Adapter = {
  name: "antigravity",
  get surface() {
    return SURFACE;
  },

  async stale(dir: string): Promise<boolean> {
    const files = [file(resolve(dir))];
    if ((await staleText(files)) || (await missingMoments(files, Object.values(EVENT)))) {
      return true;
    }
    const mcpDoc = await readJson<McpFile>(mcpFile()).catch(() => null);
    const entry = mcpDoc?.mcpServers?.memcell as { args?: string[] } | undefined;
    if (entry && Array.isArray(entry.args)) {
      if (
        !entry.args.includes("--agent") ||
        !entry.args.includes("antigravity") ||
        entry.args.includes("--dir")
      ) {
        return true;
      }
    }
    return false;
  },

  async install(projectDir: string): Promise<string> {
    const at = file(resolve(projectDir));
    const config = await readJson<HooksConfig>(at);
    const spec = (config.memcell ??= {});

    // PreInvocation (prompt-submit & session-start)
    const promptCmd = hookCommand("prompt-submit", "antigravity");
    spec.PreInvocation ??= [];
    const heldPrompt = spec.PreInvocation.find((h) =>
      hookMatches(h.command, "prompt-submit", "antigravity"),
    );
    if (heldPrompt) {
      heldPrompt.command = promptCmd;
    } else {
      spec.PreInvocation.push({ type: "command", command: promptCmd, timeout: 30 });
    }

    // PreToolUse (before-act)
    const beforeCmd = hookCommand("before-act", "antigravity");
    spec.PreToolUse ??= [];
    let heldBefore = false;
    for (const entry of spec.PreToolUse) {
      for (const h of entry.hooks ?? []) {
        if (hookMatches(h.command, "before-act", "antigravity")) {
          h.command = beforeCmd;
          heldBefore = true;
        }
      }
    }
    if (!heldBefore) {
      spec.PreToolUse.push({
        matcher: "*",
        hooks: [{ type: "command", command: beforeCmd, timeout: 30 }],
      });
    }

    // PostInvocation (turn-end)
    const turnCmd = hookCommand("turn-end", "antigravity");
    spec.PostInvocation ??= [];
    const heldTurn = spec.PostInvocation.find((h) =>
      hookMatches(h.command, "turn-end", "antigravity"),
    );
    if (heldTurn) {
      heldTurn.command = turnCmd;
    } else {
      spec.PostInvocation.push({ type: "command", command: turnCmd, timeout: 30 });
    }

    // Stop (session-end)
    const endCmd = hookCommand("session-end", "antigravity");
    spec.Stop ??= [];
    const heldEnd = spec.Stop.find((h) => hookMatches(h.command, "session-end", "antigravity"));
    if (heldEnd) {
      heldEnd.command = endCmd;
    } else {
      spec.Stop.push({ type: "command", command: endCmd, timeout: 30 });
    }

    await writeJson(at, config);
    await installMcp().catch(() => undefined);
    return at;
  },

  async remove(projectDir: string): Promise<string | null> {
    const at = file(resolve(projectDir));
    const config = await readJson<HooksConfig>(at);
    let changed = false;

    if (config.memcell) {
      delete config.memcell;
      changed = true;
    }

    await removeMcp().catch(() => undefined);

    if (!changed) return null;
    await rmIfEmptied(at, config as unknown as Record<string, unknown>, "memcell");
    return at;
  },

  async verify(projectDir: string): Promise<Wiring[]> {
    const config = await readJson<HooksConfig>(file(resolve(projectDir)));
    const spec = config.memcell;

    return MOMENTS.map((moment) => {
      let ok = false;
      if (spec) {
        if (moment === "prompt-submit" || moment === "session-start") {
          ok = Boolean(
            spec.PreInvocation?.some((h) => hookMatches(h.command, "prompt-submit", "antigravity")),
          );
        } else if (moment === "before-act") {
          ok = Boolean(
            spec.PreToolUse?.some((e) =>
              e.hooks?.some((h) => hookMatches(h.command, "before-act", "antigravity")),
            ),
          );
        } else if (moment === "turn-end") {
          ok = Boolean(
            spec.PostInvocation?.some((h) => hookMatches(h.command, "turn-end", "antigravity")),
          );
        } else if (moment === "session-end") {
          ok = Boolean(
            spec.Stop?.some((h) => hookMatches(h.command, "session-end", "antigravity")),
          );
        }
      }
      return { moment, event: EVENT[moment], ok };
    });
  },

  // ── speak — injectSteps with ephemeralMessage ─────────────────────────────
  speak(moment: Moment, context: string | null): string | null {
    if (!context) return null;
    return JSON.stringify({
      injectSteps: [{ ephemeralMessage: context }],
    });
  },

  // ── refuse — structured decision denial ──────────────────────────────────
  refuse(reason: string): string | null {
    return JSON.stringify({
      decision: "deny",
      reason,
    });
  },

  // ── read — JSONL transcript slice ─────────────────────────────────────────
  async read(payload: Incoming, from: number): Promise<Session> {
    const path = payload.transcript_path ?? payload.transcriptPath;
    if (!path) return emptySession(from);
    const said: string[] = [];
    const touched: string[] = [];

    const read = await readJsonlSlice(path, from, (raw) => {
      const rec = raw as {
        type?: string;
        source?: string;
        content?: unknown;
        tool_calls?: {
          name?: string;
          tool_name?: string;
          args?: Record<string, unknown>;
          tool_args?: Record<string, unknown>;
        }[];
      };

      const role =
        rec.type === "USER_INPUT" || rec.source === "USER_EXPLICIT"
          ? "user"
          : rec.type === "PLANNER_RESPONSE" || rec.source === "MODEL"
            ? "assistant"
            : null;

      for (const call of rec.tool_calls ?? []) {
        const name = call.name ?? call.tool_name ?? "";
        if (WRITE_TOOLS.has(name)) {
          const args = call.args ?? call.tool_args ?? {};
          const target = (args.TargetFile ?? args.AbsolutePath ?? args.path ?? args.file_path) as
            string | undefined;
          addTouched(touched, target, payload.cwd);
        }
      }

      if (!role) return;
      const text = typeof rec.content === "string" ? rec.content : "";
      if (!text.trim()) return;

      if (role === "assistant") {
        const sanitized = sanitizeAssistantText(text);
        if (sanitized) said.push(`assistant: ${sanitized}`);
      } else {
        said.push(`user: ${text.trim()}`);
      }
    });

    return { text: said.join("\n\n"), touched: touched.slice(0, TOUCHED_CAP), read };
  },
};

/**
 * Sanitizes assistant text to prevent AST/code-block dumps and huge internal monologues
 * from overwhelming the distillation stage.
 */
function sanitizeAssistantText(raw: string): string {
  // Replace large code blocks (>200 chars) with a brief placeholder so code syntax isn't mined as memory
  const strippedCode = raw.replace(/```[\s\S]*?```/g, (match) => {
    if (match.length > 200) {
      return "[code snippet omitted]";
    }
    return match;
  });

  const trimmed = strippedCode.trim();
  if (trimmed.length > 3000) {
    return trimmed.slice(0, 1500) + "\n\n[...]\n\n" + trimmed.slice(-1500);
  }
  return trimmed;
}

export const SURFACE: Surface = {
  moments: {
    "session-start": {
      event: "PreInvocation",
      inject: { via: "json", path: "injectSteps[0].ephemeralMessage" },
    },
    "prompt-submit": {
      event: "PreInvocation",
      inject: { via: "json", path: "injectSteps[0].ephemeralMessage" },
    },
    "before-act": {
      event: "PreToolUse",
      inject: { via: "json", path: "injectSteps[0].ephemeralMessage" },
    },
    "turn-end": {
      event: "PostInvocation",
      inject: { via: "json", path: "injectSteps[0].ephemeralMessage" },
    },
    "session-end": {
      event: "Stop",
      inject: { via: "json", path: "reason" },
    },
  },
  guard: {
    event: "PreToolUse",
    matcher: (tools) => (tools.length > 0 ? tools.join("|") : "*"),
    inject: { via: "json", path: "injectSteps[0].ephemeralMessage" },
    refuse: { via: "json", path: "decision", deny: "deny" },
    tools: {
      read: ["view_file", "list_dir", "grep_search", "find_by_name", "read_url_content"],
      change: [...WRITE_TOOLS],
      record: ["run_command"],
      send: ["run_command"],
    },
  },
};
