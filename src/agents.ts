import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// The agents memcell can wire, and whether each is on this machine.
//
// Detection is "does this agent keep its settings here" — the cheapest
// question with a true answer. It is not "is the binary on PATH": an agent
// installed but never run has no config yet, and one run from a different
// shell may not be on this PATH at all.

export interface Agent {
  /** What `--agent` takes. */
  name: string;
  /** As a person says it. */
  label: string;
  /** The directory whose existence means this agent has been used here. */
  home: string;
}

export const AGENTS: Agent[] = [
  { name: "claude", label: "claude code", home: ".claude" },
  { name: "antigravity", label: "google antigravity", home: join(".gemini", "antigravity") },
  { name: "gemini", label: "gemini", home: ".gemini" },
  { name: "codex", label: "codex", home: ".codex" },
  { name: "copilot", label: "copilot", home: ".copilot" },
  { name: "cursor", label: "cursor", home: ".cursor" },
  { name: "opencode", label: "opencode", home: join(".config", "opencode") },
  { name: "kilo", label: "kilo", home: join(".config", "kilo") },
  { name: "droid", label: "factory droid", home: ".factory" },
  { name: "muse", label: "muse code", home: join(".config", "muse") },
  { name: "qwen", label: "qwen code", home: ".qwen" },
  { name: "grok", label: "grok build", home: ".grok" },
  { name: "devin", label: "devin", home: join(".config", "devin") },
  { name: "openclaw", label: "openclaw", home: ".openclaw" },
  { name: "kiro", label: "kiro", home: ".kiro" },
  { name: "windsurf", label: "windsurf cascade", home: join(".codeium", "windsurf") },
  { name: "goose", label: "goose", home: join(".config", "goose") },
  { name: "cline", label: "cline", home: ".cline" },
];

export const agentNamed = (name: string): Agent | undefined =>
  AGENTS.find((a) => a.name === name.toLowerCase());

/** Which of them this machine has used. Never throws — an unreadable home
 *  directory means "not detected", not a failed command. */
export async function detected(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const agent of AGENTS) {
    const there = await access(join(homedir(), agent.home)).then(
      () => true,
      () => false,
    );
    if (there) found.add(agent.name);
  }
  if (!found.has("antigravity")) {
    const cliThere = await access(join(homedir(), ".gemini", "antigravity-cli")).then(
      () => true,
      () => false,
    );
    if (cliThere) found.add("antigravity");
  }
  if (!found.has("windsurf")) {
    const wsThere = await access(join(homedir(), ".windsurf")).then(
      () => true,
      () => false,
    );
    if (wsThere) found.add("windsurf");
  }
  if (found.has("antigravity") && found.has("gemini")) {
    const hasGeminiSettings = await access(join(homedir(), ".gemini", "settings.json")).then(
      () => true,
      () => false,
    );
    if (!hasGeminiSettings) {
      found.delete("gemini");
    }
  }
  return found;
}

/**
 * Which agent environment this process is currently running inside, if any.
 *
 * Detected via environment variables set by the agent harnesses or IDEs.
 */
export function currentAgent(): string | undefined {
  const env = process.env;
  if (
    env.ANTIGRAVITY_AGENT === "true" ||
    env.ANTIGRAVITY_CONVERSATION_ID ||
    env.ANTIGRAVITY_PROJECT_ID ||
    env.ANTIGRAVITY_AGENTAPI_EXE
  ) {
    return "antigravity";
  }
  if (env.CLAUDE_PROJECT_DIR || env.CLAUDECODE || env.CLAUDE_AGENT) {
    return "claude";
  }
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) {
    return "cursor";
  }
  if (env.WINDSURF_AGENT) {
    return "windsurf";
  }
  if (env.GOOSE_AGENT) {
    return "goose";
  }
  if (env.CLINE_AGENT) {
    return "cline";
  }
  if (env.COPILOT_AGENT || env.GITHUB_COPILOT) {
    return "copilot";
  }
  if (env.GEMINI_CLI || env.GEMINI_AGENT) {
    return "gemini";
  }
  return undefined;
}
