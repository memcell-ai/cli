import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "smol-toml";

import { PROJECT_FILE } from "./project.js";
import { machineFile } from "./machine.js";

// Settings, in two places with one precedence: **the project wins.**
//
// Global lives in the machine's own `~/.memcell/config.json` and is what a
// person sets once. Project lives in the directory's `.memcell`, beside what
// it is linked to, and is what a repository says for everyone who clones it.
// A project that states something means it, so it overrides — the same order
// git uses, for the same reason.
//
// Keys are dotted paths (`recall.limit`), stored nested. Nothing here has a
// list of legal keys: a settings file that refuses what it does not
// recognise is a settings file that cannot be forward-compatible with the
// version of memcell that reads it next.

/** Where a setting came from, in the order they win. A flag beats an
 *  environment variable beats the project's file beats the machine's. */
export type Scope = "flag" | "env" | "project" | "global";

/** Only these two are written. The other two are how an invocation speaks. */
export type WritableScope = "project" | "global";

/** The environment variable a key can also be given by, where one exists.
 *  Nothing is invented: a variable appears here only because it already
 *  meant this before there was a config file. */
const FROM_ENV: Record<string, string> = {
  "instance.url": "MEMCELL_INSTANCE",
};

/** Short spellings for keys stored deeper. The instance is `[instance].url`
 *  in the file; a person types `instance` or `url` and means that. */
const ALIASES: Record<string, string> = {
  instance: "instance.url",
  url: "instance.url",
};

/** The key as the CLI knows it. */
export function canonical(key: string): string {
  return ALIASES[key] ?? key;
}

/** Every spelling that means this key, canonical first. A file written
 *  before an alias existed still answers — a settings file that stops
 *  reading what it once accepted has silently lost somebody's setting. */
function spellings(name: string): string[] {
  return [name, ...Object.keys(ALIASES).filter((alias) => ALIASES[alias] === name)];
}

const globalFile = () => machineFile("config.json");

type Tree = Record<string, unknown>;

async function readJson(file: string): Promise<Tree> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Tree;
  } catch {
    return {};
  }
}

/** The project file is TOML: connection tables the CLI writes, plus a
 *  `[config]` table for settings. Read as a whole so a write preserves the
 *  connection it sits beside. */
async function readToml(file: string): Promise<Tree> {
  try {
    return parse(await readFile(file, "utf8")) as Tree;
  } catch {
    return {};
  }
}

/** Walk a dotted path. Undefined for anything absent or shadowed by a
 *  non-object — a half-written file answers "not set", never throws. */
function at(tree: Tree, key: string): unknown {
  let here: unknown = tree;
  for (const part of key.split(".")) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Tree)[part];
  }
  return here;
}

/** Set a dotted path, creating the objects along the way. A part that holds
 *  a non-object is replaced: the person just said what they want there. */
function put(tree: Tree, key: string, value: unknown): void {
  const parts = key.split(".");
  let here = tree;
  for (const part of parts.slice(0, -1)) {
    if (typeof here[part] !== "object" || here[part] === null) here[part] = {};
    here = here[part] as Tree;
  }
  here[parts[parts.length - 1]!] = value;
}

export interface Found {
  value: unknown;
  scope: Scope;
}

/**
 * What this key is for this invocation, and what said so.
 *
 * ONE chain, used by every setting the CLI has — so a command never reads a
 * file directly and no two commands can disagree about which source wins.
 * A flag is this invocation speaking and beats everything; an environment
 * variable is this shell; the project's file is what a repository says for
 * everyone who clones it; the machine's file is what a person set once.
 */
export async function get(
  key: string,
  opts: { flag?: string; only?: WritableScope } = {},
): Promise<Found | null> {
  const name = canonical(key);

  if (!opts.only) {
    if (opts.flag) return { value: opts.flag, scope: "flag" };
    const env = FROM_ENV[name] ? process.env[FROM_ENV[name]!] : undefined;
    if (env) return { value: env, scope: "env" };
  }

  if (opts.only !== "global") {
    const doc = await readToml(await projectFile());
    for (const spelling of spellings(name)) {
      const value = at(doc, spelling);
      if (value !== undefined) return { value, scope: "project" };
    }
    if (opts.only === "project") return null;
  }

  const global = await readJson(globalFile());
  for (const spelling of spellings(name)) {
    const value = at(global, spelling);
    if (value !== undefined) return { value, scope: "global" };
  }
  return null;
}

/** The same chain, for a setting that is a string and has a fallback. */
export async function text(
  key: string,
  fallback: string,
  flag?: string,
): Promise<{ value: string; scope: Scope | "default" }> {
  const found = await get(key, { flag });
  return found && typeof found.value === "string" && found.value
    ? { value: found.value, scope: found.scope }
    : { value: fallback, scope: "default" };
}

/**
 * The project file config reads and writes — the nearest `.memcell` at or
 * above here, or one in this directory if there is none.
 *
 * Always a path, never null: `config set` is upsert. A plain folder is not
 * an error to write a setting into, it is a folder that does not have the
 * file yet. This is separate from `findProject`, which answers "is this
 * directory CONNECTED" — a stricter question a settings write does not ask.
 */
async function projectFile(): Promise<string> {
  let dir = resolve(process.cwd());
  for (;;) {
    const at = join(dir, PROJECT_FILE);
    try {
      // A FILE, not merely a path that exists: the machine's own data lives
      // in a `.memcell` DIRECTORY in the home, so a project anywhere under
      // the home reaches it on this walk, and opening it as TOML is EISDIR.
      if ((await stat(at)).isFile()) return at;
    } catch {
      // Not here; keep walking up.
    }
    const up = dirname(dir);
    if (up === dir) return join(resolve(process.cwd()), PROJECT_FILE);
    dir = up;
  }
}

/** Where a scope's settings are written, so a command can name the file. */
export async function fileFor(scope: WritableScope): Promise<string | null> {
  return scope === "global" ? globalFile() : projectFile();
}

export async function set(key: string, value: unknown, scope: WritableScope): Promise<string> {
  const file = scope === "global" ? globalFile() : await projectFile();
  await mkdir(join(file, ".."), { recursive: true });
  if (scope === "global") {
    const tree = await readJson(file);
    put(tree, canonical(key), value);
    await writeFile(file, `${JSON.stringify(tree, null, 2)}\n`, { mode: 0o600 });
  } else {
    // The project file: everything in it is config, so a setting writes
    // straight to its table. `instance.url` lands in the same [instance].url
    // the connection uses — one place, no wrapper.
    const doc = await readToml(file);
    put(doc, canonical(key), value);
    await writeFile(file, `${stringify(doc)}\n`, { mode: 0o600 });
  }
  await chmod(file, 0o600);
  return file;
}

/** `true`, `12` and `null` mean what they look like; everything else is the
 *  string as typed. A person setting a flag should not have to know JSON,
 *  and a person setting a path must not have it mangled. */
export function read(raw: string): unknown {
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(raw)) return JSON.parse(raw);
  return raw;
}

/** How a value prints back. Strings without their quotes. */
export function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
