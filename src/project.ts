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
  /** The project owner slug. `[project].owner`. */
  owner?: string;
  /** The project slug. `[project].slug`. */
  project?: string;
  /** The project id. `[project].id`. */
  projectId?: string;
  /** The legacy space slug. `[space].slug`. */
  space: string;
  /** The space id. `[space].id`. */
  spaceId?: string;
}

interface Doc {
  instance?: { url?: string };
  project?: { id?: string; slug?: string; owner?: string };
  space?: { id?: string; slug?: string; owner?: string };
  [key: string]: unknown;
}

function fromToml(text: string): Project | null {
  const doc = parse(text) as Doc;
  const instance = doc.instance?.url;
  const slug = doc.project?.slug ?? doc.space?.slug;
  if (!instance || !slug) return null;
  const id = doc.project?.id ?? doc.space?.id;
  const owner = doc.project?.owner ?? doc.space?.owner;
  return {
    instance,
    owner,
    project: slug,
    projectId: id,
    space: slug,
    spaceId: id,
  };
}

function toToml(project: Project, existingDoc?: Doc): string {
  const slug = project.project || project.space;
  const id = project.projectId || project.spaceId;
  const owner = project.owner;
  const doc: Doc = {
    ...(existingDoc ?? {}),
    instance: {
      ...(typeof existingDoc?.instance === "object" && existingDoc?.instance
        ? existingDoc.instance
        : {}),
      url: project.instance,
    },
    project: {
      ...(typeof existingDoc?.project === "object" && existingDoc?.project
        ? existingDoc.project
        : {}),
      ...(id ? { id } : {}),
      ...(owner ? { owner } : {}),
      slug,
    },
    space: {
      ...(typeof existingDoc?.space === "object" && existingDoc?.space ? existingDoc.space : {}),
      ...(id ? { id } : {}),
      ...(owner ? { owner } : {}),
      slug,
    },
  };
  return stringify(doc);
}

/**
 * Finds the root directory of a git repository at or above `from`.
 */
export async function findGitRoot(from: string = process.cwd()): Promise<string | null> {
  let dir = resolve(from);
  for (;;) {
    const gitPath = join(dir, ".git");
    try {
      await stat(gitPath);
      return dir;
    } catch {
      // Keep walking up
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Finds the first connected project among multiple workspace root paths.
 */
export async function findProjectFromRoots(
  roots: string[],
): Promise<{ project: Project; at: string } | null> {
  for (const root of roots) {
    try {
      const found = await findProject(root);
      if (found) return found;
    } catch {
      // Continue searching next root
    }
  }
  return null;
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
        const s = await stat(at);
        if (s.isFile()) {
          const project = fromToml(await readFile(at, "utf8"));
          if (project) return { project, at };
        }
      } catch {
        // Not here (or unreadable); try the other, then up.
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Saves project configuration into the project file.
 *
 * If `at` points to an existing file (e.g. `found.at`), that file is updated.
 * If `at` is a directory or omitted, it targets the git repository root if in a git repo,
 * or the specified directory / cwd.
 * Preserves other TOML tables (such as `[config]`) already present in the file.
 */
export async function saveProject(project: Project, at?: string): Promise<string> {
  let targetFile: string;

  if (at) {
    const resolvedAt = resolve(at);
    let isDir = false;
    let isFile = false;
    try {
      const s = await stat(resolvedAt);
      isDir = s.isDirectory();
      isFile = s.isFile();
    } catch {
      // Does not exist yet: if it ends with .memcell or .memcell.toml, treat as file path
      if (resolvedAt.endsWith(PROJECT_FILE) || resolvedAt.endsWith(PROJECT_FILE_ASIDE)) {
        isFile = true;
      }
    }

    if (isFile) {
      targetFile = resolvedAt;
    } else if (isDir) {
      const classic = join(resolvedAt, PROJECT_FILE);
      const taken = await stat(classic)
        .then((s) => s.isDirectory())
        .catch(() => false);
      targetFile = taken ? join(resolvedAt, PROJECT_FILE_ASIDE) : classic;
    } else {
      // Target does not exist; if no extension or not named PROJECT_FILE, treat as dir
      const classic = join(resolvedAt, PROJECT_FILE);
      targetFile = classic;
    }
  } else {
    // No target given: check if in a git repository
    const gitRoot = await findGitRoot(process.cwd());
    const targetDir = gitRoot ?? resolve(process.cwd());
    const classic = join(targetDir, PROJECT_FILE);
    const taken = await stat(classic)
      .then((s) => s.isDirectory())
      .catch(() => false);
    targetFile = taken ? join(targetDir, PROJECT_FILE_ASIDE) : classic;
  }

  // Preserve existing TOML tables
  let existingDoc: Doc | undefined;
  try {
    const raw = await readFile(targetFile, "utf8");
    existingDoc = parse(raw) as Doc;
  } catch {
    // New or unreadable file
  }

  await writeFile(targetFile, `${toToml(project, existingDoc)}\n`, { mode: 0o600 });
  return targetFile;
}

export async function removeProject(at: string): Promise<void> {
  await rm(at, { force: true });
}
