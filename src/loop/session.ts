import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { machineDir, machineFile } from "../machine.js";

// What one working session has done so far, kept between hook firings.
//
// Each hook is a separate process: prompt-submit exits long before turn-end
// starts. So anything one leg needs to know about another has to be written
// down — which statements a recall served, which moment served them, and how
// far through the transcript the last remember got.
//
// It lives on the machine beside the keys, not in the project: it is about
// one person's session on one computer, and it is deleted when the session
// ends. A stale note is only ever the tail of a session that crashed.

export interface Note {
  space: string;
  /** Characters of the transcript already handed over, so a turn ships what
   *  is new rather than the whole conversation again. */
  read: number;
  fired: Record<string, number>;
}

const dir = () => machineFile("sessions");
const file = (id: string) => join(dir(), `${id.replace(/[^\w-]/g, "")}.json`);

const EMPTY: Note = { space: "", read: 0, fired: {} };

export async function noteFor(id: string): Promise<Note> {
  try {
    return { ...EMPTY, ...(JSON.parse(await readFile(file(id), "utf8")) as Note) };
  } catch {
    return { ...EMPTY };
  }
}

export async function keepNote(id: string, note: Note): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(id), `${JSON.stringify(note)}\n`, { mode: 0o600 });
}

export async function dropNote(id: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(file(id), { force: true });
}

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
