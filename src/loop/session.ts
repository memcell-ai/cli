import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { machineDir, machineFile } from "../machine.js";

// What one working session has done so far, kept between hook firings.
//
// Each hook is a separate process: prompt-submit exits long before turn-end
// starts. So anything one pipeline phase needs to know about another has to be written
// down — which memories a recall served, which hook served them, and how
// far through the transcript the last remember got.
//
// It lives on the machine beside the keys, not in the workspace: it is about
// one person's session on one computer, and it is deleted when the session
// ends. A stale session cache is only ever the tail of a session that crashed.

export interface ActiveMemory {
  memoryId: string;
  text: string;
  appliesAt: string[];
  refuses?: boolean;
  title?: string;
  tags?: string[];
}

export interface SessionCache {
  space: string;
  guardMode?: "strict" | "advisory";
  /** Active memories staged for in-memory pre-act evaluation. Refreshed by every
   *  recall; a session that has not recalled yet guards nothing. */
  activeMemories?: ActiveMemory[];
  /**
   * Memories SERVED immediately before an act, and which act.
   *
   * The pairing is a fact rather than an inference: the guard knows it put
   * this directive in front of this act, at this moment.
   */
  servedAt?: { memoryId: string; act: string; tool: string; became: string }[];
  /** Characters of the transcript already processed, so a turn ships what
   *  is new rather than the whole conversation again. */
  read: number;
  fired: Record<string, number>;
  /** Model detected for this session, persisted across hooks. */
  model?: string;
  /** Guidance staged during before-act to be delivered at after-act (for harnesses
   *  like Cursor whose preToolUse hook only accepts permission decisions). */
  pendingGuidance?: string | null;
}

export type Note = SessionCache;

const dir = () => machineFile("sessions");
const file = (id: string) => join(dir(), `${id.replace(/[^\w-]/g, "")}.json`);

const EMPTY: SessionCache = {
  space: "",
  read: 0,
  fired: {},
  activeMemories: [],
  servedAt: [],
};

export async function sessionCacheFor(id: string): Promise<SessionCache> {
  try {
    const raw = JSON.parse(await readFile(file(id), "utf8")) as any;
    const rawMemories = raw.activeMemories || [];
    const memories: ActiveMemory[] = rawMemories.map((m: any) => ({
      memoryId: m.memoryId || "",
      text: m.text,
      appliesAt: m.appliesAt || [],
      refuses: m.refuses,
      title: m.title,
      tags: m.tags,
    }));
    return {
      ...EMPTY,
      ...raw,
      activeMemories: memories,
      servedAt: (raw.servedAt || []).map((s: any) => ({
        memoryId: s.memoryId,
        act: s.act,
        tool: s.tool,
        became: s.became,
      })),
    };
  } catch {
    return { ...EMPTY };
  }
}
export const noteFor = sessionCacheFor;

// Best-effort, both of them, like `log` below. A session cache is how the
// next firing knows where it got to — losing one costs a re-read, and a
// re-read is harmless because the turn carries its own name. Throwing here
// would take the hook down with it, and a hook that dies takes the user's
// agent turn with it. A full disk is not a reason to break somebody's
// editor.
export async function keepSessionCache(id: string, cache: SessionCache): Promise<void> {
  try {
    await mkdir(dir(), { recursive: true });
    await writeFile(file(id), `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  } catch {
    // Nothing to say to anyone: the log lives on the same disk.
  }
}
export const keepNote = keepSessionCache;

export async function dropSessionCache(id: string): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(file(id), { force: true });
  } catch {
    // As above.
  }
}
export const dropNote = dropSessionCache;

export interface ProjectLogScope {
  owner?: string;
  project?: string;
  space?: string;
}

function sanitizeSegment(segment: string): string {
  const clean = segment
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\./, "");
  return clean || "unknown";
}

/**
 * The directory on this machine holding project-scoped files (logs, state).
 *
 * Examples:
 *   - scope with owner "alice", project "my-app" -> ~/.memcell/projects/alice/my-app
 *   - scope without owner, project "my-app" -> ~/.memcell/projects/my-app
 *   - undefined scope -> ~/.memcell
 */
export function projectDir(scope?: ProjectLogScope | string): string {
  if (!scope) return machineDir();
  if (typeof scope === "string") {
    const parts = scope.split("/").filter(Boolean).map(sanitizeSegment);
    return parts.length > 0 ? machineFile("projects", ...parts) : machineDir();
  }
  const owner = scope.owner ? sanitizeSegment(scope.owner) : undefined;
  const name = sanitizeSegment(scope.project ?? scope.space ?? "");
  if (!name) return machineDir();
  return owner ? machineFile("projects", owner, name) : machineFile("projects", name);
}

/**
 * The log file path for a project, or ~/.memcell/hook.log if unscoped.
 */
export function projectLogFile(scope?: ProjectLogScope | string): string {
  if (!scope) return machineFile("hook.log");
  const dir = projectDir(scope);
  return dir === machineDir() ? machineFile("hook.log") : join(dir, "hook.log");
}

/**
 * What happened, in one line, appended as it happens.
 *
 * A hook is silent by design — it must never print into somebody's session —
 * so without this there is no way to answer "did it fire, and what did it
 * do". Every firing writes a line whether or not it found anything, because
 * "fired and found nothing" and "never fired" are the two answers a person
 * is trying to tell apart.
 *
 * When a project context is present, writes to ~/.memcell/projects/<owner>/<project>/hook.log
 * instead of dumping into a single machine-wide god file. If unwired or outside any project,
 * falls back cleanly to ~/.memcell/hook.log.
 */
export async function log(line: string, scope?: ProjectLogScope | string): Promise<void> {
  try {
    const file = projectLogFile(scope);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${new Date().toISOString()}  ${line}\n`);
  } catch {
    // Logging is a courtesy; a hook must not fail because a disk is full.
  }
}
