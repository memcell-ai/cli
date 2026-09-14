import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { currentAgent } from "./agents.js";

// Model resolution across agents.
//
// Defaults are strictly the last resort. We prioritize:
// 1. Live runtime environment variables & telemetry
// 2. Local harness configuration files on disk
// 3. Harness defaults only when no configuration or telemetry exists

export const CANONICAL_DEFAULTS: Record<string, string> = {
  claude: "claude-3-7-sonnet",
  antigravity: "gemini-2.5-pro",
  gemini: "gemini-2.5-pro",
  cursor: "claude-3-7-sonnet",
  copilot: "claude-3-7-sonnet",
  codex: "gpt-4o",
  opencode: "claude-3-7-sonnet",
  windsurf: "cascade",
  cline: "claude-3-7-sonnet",
  droid: "claude-3-7-sonnet",
  qwen: "qwen-2.5-coder",
  grok: "grok-code",
  goose: "gpt-4o",
  devin: "devin-cognition",
  muse: "claude-3-7-sonnet",
  openclaw: "claude-3-7-sonnet",
  kilo: "claude-3-7-sonnet",
  kiro: "claude-3-7-sonnet",
};

export function canonicalDefaultModel(agentName: string): string {
  const norm = agentName.toLowerCase().trim();
  return CANONICAL_DEFAULTS[norm] ?? "claude-3-7-sonnet";
}

/**
 * Detects an actively running model from process environment variables.
 */
export function detectActiveRuntimeModel(program?: string): string | undefined {
  const env = process.env;
  if (env.MEMCELL_MODEL && env.MEMCELL_MODEL.trim()) {
    return env.MEMCELL_MODEL.trim();
  }

  const active = (program || currentAgent() || "").toLowerCase().trim();

  if (active === "claude") {
    const m = env.CLAUDE_MODEL || env.ANTHROPIC_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "antigravity") {
    const m = env.ANTIGRAVITY_MODEL || env.GEMINI_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "gemini") {
    const m = env.GEMINI_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "cursor") {
    const m = env.CURSOR_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "opencode") {
    const m = env.OPENCODE_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "codex") {
    const m = env.CODEX_MODEL || env.OPENAI_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "copilot") {
    const m = env.COPILOT_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "windsurf") {
    const m = env.WINDSURF_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "qwen") {
    const m = env.QWEN_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "grok") {
    const m = env.GROK_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "goose") {
    const m = env.GOOSE_MODEL;
    if (m && m.trim()) return m.trim();
  } else if (active === "cline") {
    const m = env.CLINE_MODEL;
    if (m && m.trim()) return m.trim();
  }

  if (env.MODEL && env.MODEL.trim()) {
    return env.MODEL.trim();
  }

  return undefined;
}

async function tryReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, "utf8");
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractModelKey(doc: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!doc) return undefined;
  for (const k of keys) {
    const v = doc[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Inspects local harness configuration files for a configured model.
 */
export async function detectAgentConfigModel(
  agentName: string,
  projectDir?: string,
): Promise<string | undefined> {
  const norm = agentName.toLowerCase().trim();
  const root = projectDir || process.cwd();
  const home = homedir();

  const pathsByAgent: Record<string, { project: string[]; home: string[]; keys: string[] }> = {
    claude: {
      project: [
        join(root, ".claude", "settings.json"),
        join(root, ".claude", "settings.local.json"),
      ],
      home: [join(home, ".claude", "settings.json"), join(home, ".claude.json")],
      keys: ["model", "defaultModel", "modelName"],
    },
    antigravity: {
      project: [join(root, ".gemini", "settings.json"), join(root, ".agents", "settings.json")],
      home: [
        join(home, ".gemini", "settings.json"),
        join(home, ".gemini", "antigravity", "settings.json"),
      ],
      keys: ["model", "defaultModel", "modelSelection"],
    },
    gemini: {
      project: [join(root, ".gemini", "settings.json")],
      home: [join(home, ".gemini", "settings.json")],
      keys: ["model", "defaultModel"],
    },
    cursor: {
      project: [join(root, ".cursor", "settings.json")],
      home: [
        join(home, ".config", "Cursor", "User", "settings.json"),
        join(home, "Library", "Application Support", "Cursor", "User", "settings.json"),
      ],
      keys: ["cursor.model", "model", "defaultModel"],
    },
    opencode: {
      project: [join(root, "opencode.json"), join(root, ".opencode.json")],
      home: [join(home, ".config", "opencode", "opencode.json")],
      keys: ["model", "defaultModel"],
    },
    copilot: {
      project: [join(root, ".vscode", "settings.json")],
      home: [
        join(home, ".config", "Code", "User", "settings.json"),
        join(home, "Library", "Application Support", "Code", "User", "settings.json"),
      ],
      keys: ["github.copilot.chat.model", "github.copilot.advanced.model", "model"],
    },
    codex: {
      project: [join(root, ".codex", "config.json")],
      home: [join(home, ".codex", "config.json")],
      keys: ["model", "defaultModel"],
    },
    windsurf: {
      project: [join(root, ".codeium", "windsurf", "settings.json")],
      home: [join(home, ".codeium", "windsurf", "settings.json")],
      keys: ["model", "defaultModel"],
    },
    cline: {
      project: [join(root, ".cline", "settings.json")],
      home: [join(home, ".cline", "settings.json")],
      keys: ["model", "defaultModel"],
    },
  };

  const spec = pathsByAgent[norm];
  if (!spec) return undefined;

  // 1. Check project-local config files first
  for (const p of spec.project) {
    const doc = await tryReadJson(p);
    const m = extractModelKey(doc, spec.keys);
    if (m) return m;
  }

  // 2. Check user-level global config files
  for (const p of spec.home) {
    const doc = await tryReadJson(p);
    const m = extractModelKey(doc, spec.keys);
    if (m) return m;
  }

  return undefined;
}

/**
 * Resolves the model for an agent following the hierarchy:
 * 1. Runtime environment variables
 * 2. Local harness configuration
 * 3. Canonical default (last resort)
 */
export async function resolveModelForAgent(
  agentName: string,
  projectDir?: string,
): Promise<string> {
  const runtime = detectActiveRuntimeModel(agentName);
  if (runtime) return runtime;

  const configured = await detectAgentConfigModel(agentName, projectDir);
  if (configured) return configured;

  return canonicalDefaultModel(agentName);
}
