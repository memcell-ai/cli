import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { machineDir, machineFile } from "../machine.js";

// What one working session has done so far, kept between hook firings.
//
// Each hook is a separate process: prompt-submit exits long before turn-end
// starts. So anything one pipeline phase needs to know about another has to be written
// down — which statements a recall served, which hook served them, and how
// far through the transcript the last remember got.
//
// It lives on the machine beside the keys, not in the project: it is about
// one person's session on one computer, and it is deleted when the session
// ends. A stale session cache is only ever the tail of a session that crashed.

export interface ActiveStatement {
  statementId: string;
  text: string;
  appliesAt: string[];
  refuses?: boolean;
  title?: string;
  tags?: string[];
}
export type ActiveRule = ActiveStatement;
export type StandingRule = ActiveStatement;

export interface SessionCache {
  space: string;
  guardMode?: "strict" | "advisory";
  /** Active statements staged for in-memory pre-act evaluation. Refreshed by every
   *  recall; a session that has not recalled yet guards nothing. */
  activeStatements?: ActiveStatement[];
  /** Backward-compatible alias for activeStatements. */
  activeRules?: ActiveStatement[];
  /** Legacy alias kept for compatibility. */
  standing?: ActiveStatement[];
  /**
   * Statements SERVED immediately before an act, and which act.
   *
   * The pairing is a fact rather than an inference: the guard knows it put
   * this directive in front of this act, at this moment. Judging afterwards from
   * a transcript has to work out both halves from prose, and measurably does
   * not — it is what catches a statement broken in the open and calls it nothing.
   *
   * Kept here and handed over with the turn payload, so judging costs one call
   * on transcript data already being sent rather than a call per act.
   */
  servedAt?: { statementId: string; act: string; tool: string; became: string }[];
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
  activeStatements: [],
  activeRules: [],
  standing: [],
  servedAt: [],
};

export async function sessionCacheFor(id: string): Promise<SessionCache> {
  try {
    const raw = JSON.parse(await readFile(file(id), "utf8")) as SessionCache;
    const statements = raw.activeStatements ?? raw.activeRules ?? raw.standing ?? [];
    return {
      ...EMPTY,
      ...raw,
      activeStatements: statements,
      activeRules: statements,
      standing: statements,
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
    cache.activeStatements ??= cache.activeRules ?? cache.standing;
    cache.activeRules ??= cache.activeStatements;
    cache.standing ??= cache.activeStatements;
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

/**
 * What happened, in one line, appended as it happens.
 *
 * A hook is silent by design — it must never print into somebody's session —
 * so without this there is no way to answer "did it fire, and what did it
 * do". Every firing writes a line whether or not it found anything, because
 * "fired and found nothing" and "never fired" are the two answers a person
 * is trying to tell apart.
 */
export async function log(line: string): Promise<void> {
  try {
    await mkdir(machineDir(), { recursive: true });
    await appendFile(machineFile("hook.log"), `${new Date().toISOString()}  ${line}\n`);
  } catch {
    // Logging is a courtesy; a hook must not fail because a disk is full.
  }
}
