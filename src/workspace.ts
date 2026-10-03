import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "smol-toml";

// What it means for a directory to be connected, written as a file the tools
// in it can read.
//
// TOML, in tables, so each block can grow without moving the others. This
// file carries WORKSPACE TRUTH only — which memcell, which space — the facts
// that are the same for every person who clones the repository, which is
// what makes committing it a feature. Identity is personal and lives in the
// machine keyring: the agent, the key's id and the key itself belong to
// whoever paired this machine, so a teammate's connect never rewrites a
// committed file.

export const WORKSPACE_FILE = ".memcell";
export const PROJECT_FILE = WORKSPACE_FILE;

/** Where the workspace file goes when `.memcell` is taken by a DIRECTORY —
 *  the embedded record's own data dir claims that name in any workspace
 *  running the single-process story, and writing a file over a directory
 *  is not a connect, it is a crash. Both names are read; the classic one
 *  is preferred wherever it exists as a file. */
export const WORKSPACE_FILE_ASIDE = ".memcell.toml";
export const PROJECT_FILE_ASIDE = WORKSPACE_FILE_ASIDE;

export interface Workspace {
  /** Which memcell — a key minted against a laptop's dev server must never
   *  be presented to the hosted one. `[instance].url`. */
  instance: string;
  /** The workspace owner slug. */
  owner?: string;
  /** The workspace slug. `[workspace].slug`. */
  workspace?: string;
  /** The workspace id. `[workspace].id`. */
  workspaceId?: string;
  /** The legacy project slug alias. `[project].slug`. */
  project?: string;
  /** The legacy project id alias. `[project].id`. */
  projectId?: string;
  /** The legacy space slug. `[space].slug`. */
  space: string;
  /** The space id. `[space].id`. */
  spaceId?: string;
  /** Whether background hooks are paused for this workspace. */
  paused?: boolean;
}

export type Project = Workspace;

interface Doc {
  instance?: { url?: string };
  workspace?: { id?: string; slug?: string; owner?: string; paused?: boolean };
  project?: { id?: string; slug?: string; owner?: string; paused?: boolean };
  paused?: boolean;
  space?: { id?: string; slug?: string; owner?: string };
  [key: string]: unknown;
}

function fromToml(text: string): Workspace | null {
  const doc = parse(text) as Doc;
  const instance = doc.instance?.url;
  const slug = doc.workspace?.slug ?? doc.project?.slug ?? doc.space?.slug;
  if (!instance || !slug) return null;
  const id = doc.workspace?.id ?? doc.project?.id ?? doc.space?.id;
  const owner = doc.workspace?.owner ?? doc.project?.owner ?? doc.space?.owner;
  const paused =
    typeof doc.workspace?.paused === "boolean"
      ? doc.workspace.paused
      : typeof doc.project?.paused === "boolean"
        ? doc.project.paused
        : typeof doc.paused === "boolean"
          ? doc.paused
          : undefined;
  return {
    instance,
    owner,
    workspace: slug,
    workspaceId: id,
    project: slug,
    projectId: id,
    space: slug,
    spaceId: id,
    ...(typeof paused === "boolean" ? { paused } : {}),
  };
}

function toToml(workspace: Workspace, existingDoc?: Doc): string {
  const slug = workspace.workspace || workspace.project || workspace.space;
  const id = workspace.workspaceId || workspace.projectId || workspace.spaceId;
  const owner = workspace.owner;
  const paused = workspace.paused;

  const workspaceTable = {
    ...(typeof existingDoc?.workspace === "object" && existingDoc?.workspace
      ? existingDoc.workspace
      : {}),
    ...(id ? { id } : {}),
    ...(owner ? { owner } : {}),
    slug,
  };

  const projectTable = {
    ...(typeof existingDoc?.project === "object" && existingDoc?.project
      ? existingDoc.project
      : {}),
    ...(id ? { id } : {}),
    ...(owner ? { owner } : {}),
    slug,
  };

  if (typeof paused === "boolean") {
    if (paused) {
      workspaceTable.paused = true;
      projectTable.paused = true;
    } else {
      delete workspaceTable.paused;
      delete projectTable.paused;
    }
  }

  const doc: Doc = {
    ...(existingDoc ?? {}),
    instance: {
      ...(typeof existingDoc?.instance === "object" && existingDoc?.instance
        ? existingDoc.instance
        : {}),
      url: workspace.instance,
    },
    workspace: workspaceTable,
    project: projectTable,
    space: {
      ...(typeof existingDoc?.space === "object" && existingDoc?.space ? existingDoc.space : {}),
      ...(id ? { id } : {}),
      ...(owner ? { owner } : {}),
      slug,
    },
  };
  delete doc.paused;
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
 * Finds the first connected workspace among multiple workspace root paths.
 */
export async function findWorkspaceFromRoots(
  roots: string[],
): Promise<{ workspace: Workspace; project: Workspace; at: string } | null> {
  for (const root of roots) {
    try {
      const found = await findWorkspace(root);
      if (found) return found;
    } catch {
      // Continue searching next root
    }
  }
  return null;
}

export const findProjectFromRoots = findWorkspaceFromRoots;

/**
 * The nearest connected directory at or above `from`.
 *
 * Walking up is what makes this usable: agents run from wherever a task put
 * them, rarely the repository root, and a workspace that only answers from its
 * own top directory is unconnected half the time.
 */
export async function findWorkspace(
  from: string = process.cwd(),
): Promise<{ workspace: Workspace; project: Workspace; at: string } | null> {
  let dir = resolve(from);
  for (;;) {
    for (const name of [WORKSPACE_FILE, WORKSPACE_FILE_ASIDE]) {
      const at = join(dir, name);
      try {
        const s = await stat(at);
        if (s.isFile()) {
          const ws = fromToml(await readFile(at, "utf8"));
          if (ws) return { workspace: ws, project: ws, at };
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

export const findProject = findWorkspace;

/**
 * Saves workspace configuration into the workspace file.
 *
 * If `at` points to an existing file (e.g. `found.at`), that file is updated.
 * If `at` is a directory or omitted, it targets the git repository root if in a git repo,
 * or the specified directory / cwd.
 * Preserves other TOML tables (such as `[config]`) already present in the file.
 */
export async function saveWorkspace(ws: Workspace, at?: string): Promise<string> {
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
      if (resolvedAt.endsWith(WORKSPACE_FILE) || resolvedAt.endsWith(WORKSPACE_FILE_ASIDE)) {
        isFile = true;
      }
    }

    if (isFile) {
      targetFile = resolvedAt;
    } else if (isDir) {
      const classic = join(resolvedAt, WORKSPACE_FILE);
      const taken = await stat(classic)
        .then((s) => s.isDirectory())
        .catch(() => false);
      targetFile = taken ? join(resolvedAt, WORKSPACE_FILE_ASIDE) : classic;
    } else {
      // Target does not exist; if no extension or not named WORKSPACE_FILE, treat as dir
      const classic = join(resolvedAt, WORKSPACE_FILE);
      targetFile = classic;
    }
  } else {
    // No target given: check if in a git repository
    const gitRoot = await findGitRoot(process.cwd());
    const targetDir = gitRoot ?? resolve(process.cwd());
    const classic = join(targetDir, WORKSPACE_FILE);
    const taken = await stat(classic)
      .then((s) => s.isDirectory())
      .catch(() => false);
    targetFile = taken ? join(targetDir, WORKSPACE_FILE_ASIDE) : classic;
  }

  // Preserve existing TOML tables
  let existingDoc: Doc | undefined;
  try {
    const raw = await readFile(targetFile, "utf8");
    existingDoc = parse(raw) as Doc;
  } catch {
    // New or unreadable file
  }

  await writeFile(targetFile, `${toToml(ws, existingDoc)}\n`, { mode: 0o600 });
  return targetFile;
}

export const saveProject = saveWorkspace;

export async function removeWorkspace(at: string): Promise<void> {
  await rm(at, { force: true });
}

export const removeProject = removeWorkspace;

/**
 * Toggles the paused status of the workspace.
 * When paused, background hooks short-circuit immediately without contacting the instance.
 */
export async function setWorkspacePaused(
  paused: boolean,
  at?: string,
): Promise<{ workspace: Workspace; project: Workspace; at: string } | null> {
  const found = at ? await findWorkspace(at) : await findWorkspace();
  if (!found || !found.workspace) return null;
  const updated: Workspace = { ...found.workspace, paused };
  await saveWorkspace(updated, found.at);
  return { workspace: updated, project: updated, at: found.at };
}

export const setProjectPaused = setWorkspacePaused;
