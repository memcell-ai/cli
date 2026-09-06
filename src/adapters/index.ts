import { claude } from "./claude.js";
import { antigravity } from "./antigravity.js";
import { removeSkill } from "./skill.js";
import { codex } from "./codex.js";
import { copilot } from "./copilot.js";
import { cursor } from "./cursor.js";
import { devin } from "./devin.js";
import { droid } from "./droid.js";
import { gemini } from "./gemini.js";
import { grok } from "./grok.js";
import { kiro } from "./kiro.js";
import { muse } from "./muse.js";
import { kilo, opencode } from "./opencode.js";
import { openclaw } from "./openclaw.js";
import { qwen } from "./qwen.js";
import { windsurf } from "./windsurf.js";
import { goose } from "./goose.js";
import { cline } from "./cline.js";
import type { Adapter } from "./shared.js";

/** Every agent whose hooks memcell can write. An agent in the catalogue
 *  without one here can be chosen and simply has nothing to install yet —
 *  which `connect` says rather than pretending otherwise. */
const BY_NAME: Record<string, Adapter> = {
  claude: claude,
  antigravity: antigravity,
  gemini: gemini,
  codex: codex,
  copilot: copilot,
  cursor: cursor,
  opencode: opencode,
  kilo: kilo,
  droid: droid,
  muse: muse,
  qwen: qwen,
  grok: grok,
  devin: devin,
  openclaw: openclaw,
  kiro: kiro,
  windsurf: windsurf,
  goose: goose,
  cline: cline,
};

export const adapterFor = (name: string): Adapter | undefined => BY_NAME[name];

export const allAdapters = (): Adapter[] => Object.values(BY_NAME);

/** Take memcell's hooks out of a directory, whichever agents have them,
 *  and name the ones that actually held some. Each adapter removes only its
 *  own and returns null when it finds none, so the names ARE the agents that
 *  were wired here — no record of what was installed is needed. */
export async function removeHooks(dir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const adapter of allAdapters()) {
    if (await adapter.remove(dir)) removed.push(adapter.name);
  }
  // The shared skill rides the same undo: one command wired this project,
  // one command leaves it clean.
  if (await removeSkill(dir)) removed.push("skill");
  return removed;
}

/** The same, for callers that only need it gone, not who held it. */
export async function removeAllHooks(dir: string): Promise<void> {
  await removeHooks(dir);
}

export type { Adapter, Wiring } from "./shared.js";
export { installSkill, removeSkill, verifySkill } from "./skill.js";

/**
 * Bring an older release's wiring up to date, in place.
 *
 * Two things changed shape: hooks stopped naming an interpreter path and a
 * baked-in agent id, and Claude Code's moved out of a settings file its own
 * program rewrites. Neither is something to make somebody read a changelog
 * about — the wiring is ours, so we carry it forward.
 *
 * It runs from any CLI entry, the hook firings included, which is what
 * makes it automatic: the first hook after an upgrade migrates itself and
 * every later one is a no-op. Detection is a text read of what a wiring
 * says, so a shape nobody has thought of yet still counts as stale the
 * moment it stops matching what this build writes.
 */
export async function migrateWiring(projectDir: string): Promise<string[]> {
  const carried: string[] = [];
  for (const adapter of allAdapters()) {
    const stale = await adapter.stale?.(projectDir).catch(() => false);
    if (!stale) continue;
    // install() is the migration: it rewrites our entries in place and
    // sweeps the locations older releases used.
    await adapter.install(projectDir).catch(() => undefined);
    carried.push(adapter.name);
  }
  return carried;
}
