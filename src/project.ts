import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "smol-toml";

// What it means for a directory to be connected, written as a file the tools
// in it can read.
//
// TOML, in tables, so each block can grow without moving the others. This
// file carries PROJECT TRUTH only — which memcell, which space — the facts
// that are the same for every person who clones the repository, which is
// what makes committing it a feature. Identity is personal and lives in the
// machine keyring: the agent, the key's id and the key itself belong to
// whoever paired this machine, so a teammate's connect never rewrites a
// committed file.

export const PROJECT_FILE = ".memcell";

/** Where the project file goes when `.memcell` is taken by a DIRECTORY —
 *  the embedded record's own data dir claims that name in any project
 *  running the single-process story, and writing a file over a directory
 *  is not a connect, it is a crash. Both names are read; the classic one
 *  is preferred wherever it exists as a file. */
export const PROJECT_FILE_ASIDE = ".memcell.toml";

export interface Project {
  /** Which memcell — a key minted against a laptop's dev server must never
   *  be presented to the hosted one. `[instance].url`. */
  instance: string;
  /** The space slug, as the URL paths address it. `[space].slug`. */
  space: string;
  /** The space id. `[space].id`. */
  spaceId?: string;
}

interface Doc {
  instance?: { url?: string };
  space?: { id?: string; slug?: string };
}

function fromToml(text: string): Project | null {
  const doc = parse(text) as Doc;
  const instance = doc.instance?.url;
  const space = doc.space?.slug;
  if (!instance || !space) return null;
  return { instance, space, spaceId: doc.space?.id };
}

function toToml(project: Project): string {
  const doc: Doc = {
    instance: { url: project.instance },
    space: { ...(project.spaceId ? { id: project.spaceId } : {}), slug: project.space },
  };
  return stringify(doc);
}

/**
 * The nearest connected directory at or above `from`.
 *
 * Walking up is what makes this usable: agents run from wherever a task put
 * them, rarely the repository root, and a project that only answers from its
 * own top directory is unconnected half the time.
 */
export async function findProject(
  from: string = process.cwd(),
): Promise<{ project: Project; at: string } | null> {
  let dir = resolve(from);
  for (;;) {
    for (const name of [PROJECT_FILE, PROJECT_FILE_ASIDE]) {
      const at = join(dir, name);
      try {
        const project = fromToml(await readFile(at, "utf8"));
        if (project) return { project, at };
      } catch {
        // Not here (or a directory wearing the name); try the other, then up.
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function saveProject(project: Project, at: string = process.cwd()): Promise<string> {
  const dir = resolve(at);
  const classic = join(dir, PROJECT_FILE);
  const taken = await stat(classic)
    .then((s) => s.isDirectory())
    .catch(() => false);
  const path = taken ? join(dir, PROJECT_FILE_ASIDE) : classic;
  await writeFile(path, `${toToml(project)}\n`, { mode: 0o600 });
  return path;
}

export async function removeProject(at: string): Promise<void> {
  await rm(at, { force: true });
}
