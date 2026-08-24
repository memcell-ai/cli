import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isOurs, type Moment } from "../loop/moments.js";
import type { Surface } from "./surface.js";
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

  /**
   * What this harness can do, declared — see surface.ts.
   *
   * Optional only while the thirteen are being filled in; every capability
   * inside it is answered with how or with why not, so absence here is the
   * one remaining place a reader could mistake our backlog for the agent's
   * limit. That is what the migration closes.
   */
  surface?: Surface;

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
   * Stop the act about to happen, in this harness's own refusal, with the
   * rule's words as the reason.
   *
   * Absent where a harness has no richer way to say it than an exit code —
   * the command falls back to exit 2 with the reason on stderr, which every
   * harness surveyed understands. Null from an adapter that HAS this means
   * the same: say nothing, fall back.
   */
  refuse?(reason: string): string | null;

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

/** A config file that exists but cannot be parsed. Its own error, because
 *  the two failures have opposite correct answers. */
export class UnreadableConfig extends Error {
  constructor(readonly file: string) {
    super(
      `${file} is not valid JSON. memcell will not rewrite a file it cannot read — fix or move it, then run this again.`,
    );
    this.name = "UnreadableConfig";
  }
}

/**
 * The document, or an empty one when there is NO file.
 *
 * Absent and unreadable are different facts and used to share an answer:
 * any failure returned `{}`, and the caller then merged its own entry into
 * that empty object and wrote it back — over a config the user wrote, with
 * a trailing comma or a comment in it. The file was theirs and it was gone.
 * Missing is an empty document; malformed is a refusal.
 */
export async function readJson<T>(file: string): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {} as T;
    throw err;
  }
  // An empty file is a new one somebody touched, not a broken one.
  if (text.trim() === "") return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UnreadableConfig(file);
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  // Written beside and moved into place: a crash midway through leaves the
  // previous file whole rather than half a document.
  const at = `${file}.memcell-tmp`;
  await writeFile(at, `${JSON.stringify(value, null, 2)}\n`);
  await rename(at, file);
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
/**
 * Wiring that is missing a moment memcell now fires at.
 *
 * `staleText` catches wiring written in an older SHAPE. This catches wiring
 * that is the right shape and simply predates a moment — which is what an
 * upgrade that adds one leaves behind everywhere, and it is invisible to
 * every other check: the hooks are current, portable, and quietly one
 * moment short.
 *
 * Nobody should have to know that. The migration already runs on every entry
 * including the hook firings, so the first hook after an upgrade carries the
 * wiring forward on its own — but only if something notices, and until now
 * nothing did.
 *
 * A project with no memcell wiring at all is not stale, it is unwired, and
 * installing into it uninvited is a different act entirely.
 */
export async function missingMoments(files: string[], events: string[]): Promise<boolean> {
  const texts = await Promise.all(files.map((at) => readFile(at, "utf8").catch(() => "")));
  const text = texts.join("\n");
  if (!text.includes("memcell")) return false;
  return events.some((event) => event.length > 0 && !text.includes(event));
}

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
  const { THROWAWAY } = await import("../loop/moments.js");
  return new Promise((done) => {
    // WHERE it resolves is the whole question. Under `npx`, `memcell`
    // resolves inside the runner's own cache, so an exit code alone says
    // "found" for a path that will be pruned — and the hooks this command
    // just wrote name `memcell`, so they die with it. That is the silent
    // failure this check exists to prevent, and it was reporting success
    // in exactly the case it was written for.
    const p = spawn("sh", ["-lc", "command -v memcell"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let where = "";
    p.stdout?.on("data", (chunk: Buffer) => {
      where += chunk.toString();
    });
    p.on("close", (code) => done(code === 0 && where.trim() !== "" && !THROWAWAY.test(where)));
    p.on("error", () => done(false));
  });
}
