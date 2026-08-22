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
  return found;
}
