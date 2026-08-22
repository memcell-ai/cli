import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isOurs, type Moment } from "../loop/moments.js";
import type { Incoming, Session } from "./capture.js";

// What every adapter shares — and the principle the whole layer stands on:
// an adapter owns EVERYTHING memcell knows about one agent. How its hooks
// are installed and verified, how memcell's answer is spoken back in its
// dialect, and how its session record is read. Nothing outside an adapter
// switches on an agent's name: a new agent is one file and one registry
// line, and an agent that changes its config or its record format is one
// file touched. Every claim in an adapter carries its verification
// status: driven live, or documented-but-not-yet-driven, stated where the
// claim is made.
//
// Hooks carry no secret — the command is a frozen string and the key is
// read at runtime from the machine keyring — so they live project-side,
// where committing them is a feature: a teammate who clones gets the
// wiring and only needs their own key.

export interface Wiring {
  moment: string;
  event: string;
  ok: boolean;
}

/** What the harness said at the moment the hook fired — echoed back where a
 *  dialect needs it (copilot's prompt event REPLACES the prompt). */
export interface Heard {
  prompt?: string;
  transformedPrompt?: string;
}

export interface Adapter {
  name: string;

  // ── wiring — writing and removing memcell's hooks in this agent's config ─
  install(projectDir: string): Promise<string>;
  /** Whether what is wired here was written by an older release and should
   *  be carried forward. Absent means an adapter has never changed shape. */
  stale?(projectDir: string): Promise<boolean>;
  remove(projectDir: string): Promise<string | null>;
  verify(projectDir: string): Promise<Wiring[]>;

  /**
   * Speak memcell's answer in this agent's dialect — the exact JSON its
   * harness parses from the hook's stdout. Null means say nothing, and
   * nothing is always safe: a wrong dialect is worse than a dropped
   * injection.
   */
  speak(moment: Moment, context: string | null, heard: Heard): string | null;

  /**
   * Read this agent's session record — the capture dialect, the mirror of
   * `speak`. Produces the turn's prose and the NAMES of the files it wrote
   * (never contents), from whatever this agent's best mechanism is: the
   * transcript its hook handed over, a record located on disk, a database.
   * A record it cannot find reads as empty — silence, never a guess.
   */
  read(payload: Incoming, from: number): Promise<Session>;
}

export const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

export async function readJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return {} as T;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write the document back — or remove the file entirely when taking our
 *  entry out left nothing at all, so an unwire leaves no empty husk. */
export async function rmIfEmptied(
  file: string,
  doc: Record<string, unknown>,
  key: string,
): Promise<void> {
  const held = doc[key];
  if (held && typeof held === "object" && Object.keys(held).length === 0) delete doc[key];
  if (Object.keys(doc).length === 0) await rm(file, { force: true });
  else await writeJson(file, doc);
}

/** An entry is OURS if its command is our hook, whatever invocation leads
 *  it. Everything else in these files belongs to the person and is never
 *  touched. */
export const ours = (command: string | undefined): boolean =>
  typeof command === "string" && isOurs(command);

/** The MCP registration every client gets, in its own dialect. Same law as
 *  the hooks: the bare word and nothing else. An absolute interpreter path
 *  is one machine's truth written into a file other machines read, and the
 *  entry is committed on purpose — a teammate who clones gets the bridge
 *  and needs only their own key, which the bridge resolves at run time from
 *  whichever wired directory the client launched in. No secret travels. */
export const MCP_COMMAND = "memcell";
export const MCP_ARGS = ["mcp"];

/** An MCP entry is OURS whatever invocation leads it — the bare word, an
 *  absolute interpreter + entry, or the runner form. */
export const oursMcp = (entry: unknown): boolean => {
  if (typeof entry !== "object" || entry === null) return false;
  const held = entry as { command?: string | string[]; args?: string[] };
  const words = [
    ...(Array.isArray(held.command) ? held.command : [held.command ?? ""]),
    ...(held.args ?? []),
  ];
  return words.some((w) => w.includes("memcell")) && words[words.length - 1] === "mcp";
};

/**
 * Whether a config file holds a wiring an OLDER release wrote.
 *
 * Read as text on purpose: every adapter keeps its wiring in a different
 * dialect — JSON, TOML, a generated plugin — and what makes one stale is
 * the same in all of them. A command that names an interpreter path or
 * carries `--agent` was written before the wiring became portable, and one
 * that names memcell in a file this build no longer writes is in the wrong
 * place. Neither needs the file parsed to be recognised.
 */
export async function staleText(files: string[]): Promise<boolean> {
  for (const at of files) {
    const text = await readFile(at, "utf8").catch(() => "");
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.includes("memcell") || !line.includes("hook")) continue;
      // The two shapes an older release left behind.
      if (line.includes("--agent")) return true;
      if (/["'\s](\/|[A-Za-z]:\\)[^"'\s]*memcell/.test(line)) return true;
    }
  }
  return false;
}

/**
 * Whether a hook's own shell can resolve `memcell`.
 *
 * The wiring names the bare word, which is what makes it portable and
 * committable — but a hook does not run in the shell that wired it, and an
 * npx run installs no binary at all. Unresolvable, every hook would fail on
 * every session forever, silently, because a hook that fails is a hook that
 * does nothing. So connect asks the question once, out loud, instead.
 */
export async function memcellOnPath(): Promise<boolean> {
  const { spawn } = await import("node:child_process");
  return new Promise((done) => {
    const p = spawn("sh", ["-lc", "command -v memcell"], { stdio: "ignore" });
    p.on("close", (code) => done(code === 0));
    p.on("error", () => done(false));
  });
}
