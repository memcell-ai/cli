import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "smol-toml";

// Dedicated workspace folder and file names
export const WORKSPACE_DIR = ".memcell";
export const WORKSPACE_CONFIG_FILE = "config.toml";
export const WORKSPACE_GITIGNORE = ".gitignore";

// Canonical path to config file relative to project root
export const WORKSPACE_FILE = join(WORKSPACE_DIR, WORKSPACE_CONFIG_FILE);
export const PROJECT_FILE = WORKSPACE_FILE;

// Legacy single-file formats that are automatically self-healed into .memcell/
export const LEGACY_WORKSPACE_FILES = [".memcell", ".memcell.toml"] as const;
export const WORKSPACE_FILE_ASIDE = ".memcell.toml";
export const PROJECT_FILE_ASIDE = WORKSPACE_FILE_ASIDE;

const DEFAULT_GITIGNORE = `# MemCell project workspace local state
*
!.gitignore
!config.toml
`;

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

export interface FoundWorkspace {
  workspace: Workspace;
  project: Workspace;
  /** Absolute path to .memcell/config.toml */
  at: string;
  /** Absolute path to the project root directory containing .memcell/ */
  root: string;
}

interface Doc {
  instance?: { url?: string };
  workspace?: { id?: string; slug?: string; owner?: string; paused?: boolean };
  project?: { id?: string; slug?: string; owner?: string; paused?: boolean };
  paused?: boolean;
  space?: { id?: string; slug?: string; owner?: string };
  [key: string]: unknown;
}

function fromToml(text: string): Workspace | null {
  try {
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
  } catch {
    return null;
  }
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

  if (typeof paused === "boolean") {
    if (paused) {
      workspaceTable.paused = true;
    } else {
      delete workspaceTable.paused;
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
  };
  delete (doc as any).project;
  delete (doc as any).space;
  delete doc.paused;
  return stringify(doc);
}

/**
 * Resolves the project root directory from a FoundWorkspace object or path.
 */
export function workspaceRoot(found: { at: string; root?: string }): string {
  if (found.root) return found.root;
  if (found.at.endsWith(WORKSPACE_CONFIG_FILE)) {
    return dirname(dirname(found.at));
  }
  return dirname(found.at);
}

/**
 * Ensures the .memcell/ directory has a valid .gitignore file.
 */
export async function ensureGitignore(dotMemcellDir: string): Promise<void> {
  const gitignorePath = join(dotMemcellDir, WORKSPACE_GITIGNORE);
  try {
    const s = await stat(gitignorePath);
    if (s.size === 0) {
      await writeFile(gitignorePath, DEFAULT_GITIGNORE, { mode: 0o644 });
    }
  } catch {
    await writeFile(gitignorePath, DEFAULT_GITIGNORE, { mode: 0o644 }).catch(() => {});
  }
}

/**
 * Self-heals a legacy workspace (single `.memcell` or `.memcell.toml` file)
 * into a dedicated `.memcell/` directory with `config.toml` and `.gitignore`.
 */
async function selfHealLegacyFile(dir: string, legacyFile: string): Promise<FoundWorkspace | null> {
  const legacyPath = join(dir, legacyFile);
  try {
    const s = await stat(legacyPath);
    if (!s.isFile()) return null;
    const content = await readFile(legacyPath, "utf8");
    const ws = fromToml(content);
    if (!ws) return null;

    // Delete legacy file before directory creation
    await rm(legacyPath, { force: true });
    const legacyAside = join(dir, WORKSPACE_FILE_ASIDE);
    if (legacyAside !== legacyPath) {
      await rm(legacyAside, { force: true }).catch(() => {});
    }

    const dotMemcellDir = join(dir, WORKSPACE_DIR);
    await mkdir(dotMemcellDir, { recursive: true });
    const configPath = join(dotMemcellDir, WORKSPACE_CONFIG_FILE);

    await writeFile(configPath, `${toToml(ws)}\n`, { mode: 0o600 });
    await ensureGitignore(dotMemcellDir);

    return {
      workspace: ws,
      project: ws,
      at: configPath,
      root: dir,
    };
  } catch {
    return null;
  }
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
export async function findWorkspaceFromRoots(roots: string[]): Promise<FoundWorkspace | null> {
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
 * Automatically self-heals legacy `.memcell` or `.memcell.toml` files into `.memcell/config.toml`.
 */
export async function findWorkspace(from: string = process.cwd()): Promise<FoundWorkspace | null> {
  let dir = resolve(from);
  for (;;) {
    const dotMemcell = join(dir, WORKSPACE_DIR);
    const legacyAside = join(dir, WORKSPACE_FILE_ASIDE);

    try {
      const s = await stat(dotMemcell);
      if (s.isDirectory()) {
        await ensureGitignore(dotMemcell);
        const configPath = join(dotMemcell, WORKSPACE_CONFIG_FILE);
        try {
          const cs = await stat(configPath);
          if (cs.isFile()) {
            const raw = await readFile(configPath, "utf8");
            const ws = fromToml(raw);
            if (ws) {
              await ensureGitignore(dotMemcell);
              await rm(legacyAside, { force: true }).catch(() => {});
              if (raw.includes("[project]") || raw.includes("[space]")) {
                let existingDoc: Doc | undefined;
                try {
                  existingDoc = parse(raw) as Doc;
                } catch {
                  // ignore
                }
                await writeFile(configPath, `${toToml(ws, existingDoc)}\n`, { mode: 0o600 }).catch(
                  () => {},
                );
              }
              return { workspace: ws, project: ws, at: configPath, root: dir };
            }
          }
        } catch {
          // config.toml not in .memcell/ yet, check if legacy .memcell.toml is beside it
          try {
            const as = await stat(legacyAside);
            if (as.isFile()) {
              const rawAside = await readFile(legacyAside, "utf8");
              const wsAside = fromToml(rawAside);
              if (wsAside) {
                await writeFile(configPath, `${toToml(wsAside)}\n`, { mode: 0o600 });
                await ensureGitignore(dotMemcell);
                await rm(legacyAside, { force: true }).catch(() => {});
                return { workspace: wsAside, project: wsAside, at: configPath, root: dir };
              }
            }
          } catch {
            // Neither exists
          }
        }
      } else if (s.isFile()) {
        // .memcell exists as a FILE: self-heal it to a dedicated directory!
        const healed = await selfHealLegacyFile(dir, WORKSPACE_DIR);
        if (healed) return healed;
      }
    } catch {
      // .memcell does not exist, check if legacy .memcell.toml exists alone
      try {
        const as = await stat(legacyAside);
        if (as.isFile()) {
          const healed = await selfHealLegacyFile(dir, WORKSPACE_FILE_ASIDE);
          if (healed) return healed;
        }
      } catch {
        // Neither exists in this directory
      }
    }

    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export const findProject = findWorkspace;

/**
 * Saves workspace configuration into the dedicated `.memcell/config.toml` file.
 */
export async function saveWorkspace(ws: Workspace, at?: string): Promise<string> {
  let projectRoot: string;

  if (at) {
    const resolvedAt = resolve(at);
    let s: any = null;
    try {
      s = await stat(resolvedAt);
    } catch {
      // Does not exist yet
    }

    if (s?.isDirectory()) {
      if (resolvedAt.endsWith(WORKSPACE_DIR) || resolvedAt.endsWith(`/${WORKSPACE_DIR}`)) {
        projectRoot = dirname(resolvedAt);
      } else {
        projectRoot = resolvedAt;
      }
    } else if (s?.isFile()) {
      if (resolvedAt.endsWith(WORKSPACE_CONFIG_FILE)) {
        projectRoot = dirname(dirname(resolvedAt));
      } else {
        projectRoot = dirname(resolvedAt);
      }
    } else {
      if (resolvedAt.endsWith(join(WORKSPACE_DIR, WORKSPACE_CONFIG_FILE))) {
        projectRoot = dirname(dirname(resolvedAt));
      } else if (resolvedAt.endsWith(WORKSPACE_DIR)) {
        projectRoot = dirname(resolvedAt);
      } else {
        projectRoot = resolvedAt;
      }
    }
  } else {
    const gitRoot = await findGitRoot(process.cwd());
    projectRoot = gitRoot ?? resolve(process.cwd());
  }

  const dotMemcellDir = join(projectRoot, WORKSPACE_DIR);
  await mkdir(dotMemcellDir, { recursive: true });

  const targetFile = join(dotMemcellDir, WORKSPACE_CONFIG_FILE);

  let existingDoc: Doc | undefined;
  try {
    const raw = await readFile(targetFile, "utf8");
    existingDoc = parse(raw) as Doc;
  } catch {
    // New or unreadable file
  }

  await writeFile(targetFile, `${toToml(ws, existingDoc)}\n`, { mode: 0o600 });
  await ensureGitignore(dotMemcellDir);

  // Clean up any legacy file
  await rm(join(projectRoot, WORKSPACE_FILE_ASIDE), { force: true }).catch(() => {});

  return targetFile;
}

export const saveProject = saveWorkspace;

/**
 * Removes the dedicated `.memcell/` directory.
 */
export async function removeWorkspace(at: string): Promise<void> {
  let targetDir = resolve(at);
  if (targetDir.endsWith(WORKSPACE_CONFIG_FILE)) {
    targetDir = dirname(targetDir);
  }
  await rm(targetDir, { recursive: true, force: true });
}

export const removeProject = removeWorkspace;

/**
 * Toggles the paused status of the workspace.
 * When paused, background hooks short-circuit immediately without contacting the instance.
 */
export async function setWorkspacePaused(
  paused: boolean,
  at?: string,
): Promise<FoundWorkspace | null> {
  const found = at ? await findWorkspace(at) : await findWorkspace();
  if (!found || !found.workspace) return null;
  const updated: Workspace = { ...found.workspace, paused };
  await saveWorkspace(updated, found.at);
  return { workspace: updated, project: updated, at: found.at, root: found.root };
}

export const setProjectPaused = setWorkspacePaused;
