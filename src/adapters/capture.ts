import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import { log } from "../loop/session.js";

// The capture toolkit adapters compose — the primitives of reading a
// session back, shared so twenty adapters do not grow twenty slightly
// different laws. What every adapter's `read` must produce is a `Session`;
// how it produces one is the adapter's own business (a transcript the hook
// was handed, a record located on disk, a database) — these are the pieces
// they build it from.
//
// THE LAW every reader obeys: the NAMES of written files travel, never a
// byte of their contents. And a reader that cannot find its record returns
// empty — silence, never a guess.

/** An error in one line, for the log. A reader's trouble is never thrown at
 *  the agent — the turn goes on — so the log is the only place it can be
 *  said, and it has to be legible there. */
const reason = (trouble: unknown): string =>
  trouble instanceof Error ? trouble.message : String(trouble);

export interface Session {
  /** The conversation since `from`, as "role: text" blocks. */
  text: string;
  /** The names of the files this slice's turns wrote — relative to the
   *  project where the reader could tell, capped. */
  touched: string[];
  /** How far into the record this read reached, so the next turn slices
   *  only what is new. Its meaning is per-adapter (a byte offset, a line
   *  count); it is only ever compared to itself. */
  read: number;
}

/** What a harness hands the hook on stdin — the fields the adapters read.
 *  Field spelling varies by agent (snake and camel are both real). */
export interface Incoming {
  prompt?: string;
  transformedPrompt?: string;
  cwd?: string;
  session_id?: string;
  sessionId?: string;
  transcript_path?: string;
  transcriptPath?: string;
}

/** How many file names one hand-over may report. More than this is a
 *  sweep, and a sweep's story is its own summary line, not a wall of
 *  paths. */
export const TOUCHED_CAP = 20;

export const emptySession = (from: number): Session => ({ text: "", touched: [], read: from });

/** A path made relative to the project when it sits inside it, so the
 *  record reads `src/api.ts` rather than a machine-specific absolute
 *  path. */
export function relativeTo(file: string, projectDir?: string): string {
  return projectDir && file.startsWith(`${projectDir}/`) ? file.slice(projectDir.length + 1) : file;
}

/** Collect a touched file name — deduplicated, relativized. */
export function addTouched(touched: string[], file: string | undefined, projectDir?: string): void {
  if (!file) return;
  const named = relativeTo(file, projectDir);
  if (!touched.includes(named)) touched.push(named);
}

/**
 * Walk the NEW lines of a JSONL record, tolerating the half-written tail
 * of a live file. Returns how far the read reached, in bytes — the same
 * number the caller hands back next turn.
 */
/** How the slice reaches its bytes. Injectable for one reason: the branch
 *  that matters — lines delivered and THEN a failure — cannot be reached
 *  with a real file, and it is the branch that once wedged every session on
 *  the machine. A seam here is cheaper than a defect nobody can test. */
export type OpenSlice = (path: string, start: number) => NodeJS.ReadableStream;

const openFile: OpenSlice = (path, start) => createReadStream(path, { start, encoding: "utf8" });

/**
 * The most of a record one turn will read.
 *
 * A backlog has to be BOUNDED, and the bound has to be here rather than at
 * the door. A delivery the instance refuses for size rolls the offset back
 * so the turn can be retried — correct for an outage, and a trap for a
 * refusal the same bytes will always earn: the next read starts at the same
 * place, reaches a now-larger end, and is refused again. Nothing recovers.
 *
 * Measured on 2026-08-26: one session's record reached 879 MB against a
 * door that takes 600k characters, and capture had been wedged for two days
 * — reading the whole file into memory each turn to be refused each turn.
 *
 * Generous against any real turn, and small enough that reading it costs
 * nothing. Past it the read starts near the END: recent work is what a
 * session is worth capturing for, and the alternative on a backlog this
 * size is to capture nothing at all, forever.
 */
export const READ_CEILING = 4_000_000;

export async function readJsonlSlice(
  path: string,
  from: number,
  onEntry: (entry: unknown) => void,
  open: OpenSlice = openFile,
): Promise<number> {
  // STREAMED from the offset, never read whole.
  //
  // This used to be readFile(path, "utf8") and then slice(from). A long
  // session's transcript passes Node's maximum string length, readFile
  // throws ERR_STRING_TOO_LONG, and the failure was swallowed into an
  // empty string — so the hand-over reported "nothing new" and the offset
  // never advanced, forever, on exactly the long dense sessions worth
  // capturing. It also meant holding the entire record in memory to read
  // the tail of it. Reading from the byte offset costs the delta and
  // nothing else.
  const size = await stat(path)
    .then((s) => s.size)
    .catch(() => -1);
  // Unreadable, or the file was replaced by a shorter one — start over
  // rather than seek past its end and report silence.
  if (size < 0) return from;
  const behind = from > size ? 0 : from;
  // Skipping lands mid-line, which drops one entry: the parse below already
  // tolerates that — it is the same shape as the half-written tail of a live
  // file — and one lost line beside a skipped backlog is not the problem.
  const start = size - behind > READ_CEILING ? size - READ_CEILING : behind;
  if (start !== behind) {
    await log(
      `record is ${Math.round((size - behind) / 1e6)}MB behind — reading the last ${Math.round(READ_CEILING / 1e6)}MB and skipping the rest`,
    );
  }

  let read = start;
  await new Promise<void>((resolve, reject) => {
    const stream = open(path, start);
    // Listen for trouble BEFORE anything starts pulling. `createInterface`
    // begins consuming immediately, so a stream that fails on its first
    // read emits into a listener that does not exist yet — the error goes
    // unhandled and this promise never settles, which hangs the turn rather
    // than failing it.
    stream.on("error", reject);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    // Readline raises its OWN error when its input fails, and an 'error'
    // with no listener is an uncaught exception — which would take the hook
    // process down rather than fail open, against the law every leg here
    // obeys. Whichever of the two settles first wins; the other is spent.
    lines.on("error", reject);
    lines.on("line", (line) => {
      // Byte length, because the offset is a byte offset and a transcript
      // carries characters that are not one byte each.
      read += Buffer.byteLength(line, "utf8") + 1;
      if (!line.trim()) return;
      try {
        onEntry(JSON.parse(line));
      } catch {
        // A half-written line is the tail of a live file, not a problem.
      }
    });
    lines.on("close", resolve);
  }).catch(async (trouble: unknown) => {
    // The lines already delivered to `onEntry` are the caller's now — it
    // has built material out of them and will hand that material over. So
    // the offset KEEPS what they consumed: `read` sits at the start of the
    // line that failed, and the next turn resumes exactly there.
    //
    // It used to reset to `start` here, on the reasoning that an unreadable
    // record is silence and silence must not move the offset. That is only
    // true if the material is discarded too, and it is not. Returning
    // material with an offset that had not moved named the next turn
    // identically to this one — the turn key is the session plus this
    // offset — so every later turn stood itself down against its own
    // predecessor's claim and the session never captured again.
    //
    // Said out loud, because a swallowed read error is why that took two
    // days to find: the hook log looked busy the entire time.
    await log(`read failed at byte ${read} — ${reason(trouble)}`);
  });
  return Math.min(read, size);
}

/**
 * The files an apply_patch envelope names.
 *
 * The one grammar half the field shares — Codex, Copilot, Muse, opencode
 * and Grok all move files with `*** Add File:` / `*** Update File:` /
 * `*** Delete File:` / `*** Move to:` markers around the patch body. The
 * paths on the marker lines are what travel; the body never does.
 */
export function patchPaths(patch: string): string[] {
  const files: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
    files.push(m[1]!.trim());
  }
  return files;
}

/**
 * The path a write-shaped tool call addressed, whatever the agent calls
 * the field. The babel is finite — `filePath` (opencode, kilo), `file_path`
 * (gemini, qwen, grok, droid), `path` (copilot, kiro, cline, muse),
 * `filepath` (continue), `notebook_path` (claude notebooks) — and it is
 * resolved HERE, once, so no adapter re-learns it.
 */
export function pathOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ["file_path", "filePath", "path", "filepath", "notebook_path", "target_path"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
