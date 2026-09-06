import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { machineDir, machineFile } from "./machine.js";

// Where identity lives, which is deliberately not where the wiring lives.
//
// `.memcell` sits in the project and names the instance and the space —
// project truth, identical for every clone, safe to commit. Everything
// personal is HERE: the key, its id, and the wired agent's id, found at
// runtime by the directory that was paired. A project file carrying any of
// it would either leak a credential one `git add .` away from public, or
// make every teammate's connect rewrite a committed file.

export interface AgentKey {
  instance: string;
  keyId: string;
  key: string;
  project: string;
  /** The space this key answers for.
   *
   *  `.memcell` names ONE instance and space, so for a long time the space
   *  could be read from there. A directory can hold keys for several
   *  instances, though — the store is keyed by both — and the moment a
   *  command may be pointed at one of the others, the project file names
   *  the wrong space. Absent on keys minted before this. */
  space?: string;
  /** The wired agent's own id — personal, like the key, so it lives here
   *  rather than in the committed project file. */
  agentId?: string;
  /** The specific agent program name (e.g. 'antigravity', 'claude', 'cursor')
   *  this key authenticates for. */
  agent?: string;
}

interface Store {
  keys?: Record<string, AgentKey>;
}

const dir = machineDir;
const file = () => machineFile("agent-keys.json");

/** Instance and id together: an id is unique only within one memcell, and a
 *  key minted against a laptop's dev server must never be found for the
 *  hosted one. */
const handle = (instance: string, keyId: string) => `${instance.replace(/\/+$/, "")}|${keyId}`;

async function read(): Promise<Store> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Store;
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(file(), 0o600);
}

/**
 * Prunes prior keys for a specific project directory and instance.
 *
 * When reconnecting, the server revokes/supersedes prior keys for that machine/agent.
 * Pruning matching entries ensures the keyring does not hold dead keys that cause
 * random 401s or agent disconnections.
 */
export async function pruneProjectKeys(
  instance: string,
  projectDir: string,
  agentName?: string,
): Promise<number> {
  const store = await read();
  if (!store.keys) return 0;

  const real = (p: string) => realpath(resolve(p)).catch(() => resolve(p));
  const at = await real(projectDir);
  const wanted = instance.replace(/\/+$/, "");

  const remaining: Record<string, AgentKey> = {};
  let pruned = 0;

  for (const [h, keyEntry] of Object.entries(store.keys)) {
    const isSameInstance = keyEntry.instance.replace(/\/+$/, "") === wanted;
    const isSameProject = (await real(keyEntry.project)) === at;
    const isSameAgent = agentName
      ? keyEntry.agent?.toLowerCase() === agentName.toLowerCase()
      : true;

    if (isSameInstance && isSameProject && isSameAgent) {
      pruned++;
    } else {
      remaining[h] = keyEntry;
    }
  }

  if (pruned > 0) {
    await write({ keys: remaining });
  }
  return pruned;
}

export async function saveAgentKey(entry: AgentKey): Promise<void> {
  const store = await read();
  const real = (p: string) => realpath(resolve(p)).catch(() => resolve(p));
  const targetProject = await real(entry.project);
  const targetInstance = entry.instance.replace(/\/+$/, "");
  const targetAgent = entry.agent?.toLowerCase();

  const cleaned: Record<string, AgentKey> = {};

  for (const [h, k] of Object.entries(store.keys ?? {})) {
    const isSameInstance = k.instance.replace(/\/+$/, "") === targetInstance;
    const isSameProject = (await real(k.project)) === targetProject;
    const isSameAgent =
      targetAgent !== undefined ? k.agent?.toLowerCase() === targetAgent : k.agent === undefined;

    if (isSameInstance && isSameProject && isSameAgent) {
      // Supersede prior key for this exact agent in this project
      continue;
    }
    cleaned[h] = k;
  }

  cleaned[handle(entry.instance, entry.keyId)] = { ...entry, project: resolve(entry.project) };
  await write({ keys: cleaned });
}

export async function agentKeyFor(instance: string, keyId: string): Promise<AgentKey | null> {
  return (await read()).keys?.[handle(instance, keyId)] ?? null;
}

/** The pairing for a wired DIRECTORY — how everything that starts from a
 *  `.memcell` finds its identity, now that the file carries none. The
 *  newest entry wins when reconnects have piled up: connect replaces the
 *  handle it writes, but an old pairing against the same instance may
 *  linger, and the one made last is the one that works. */
export async function agentKeyForProject(
  instance: string,
  projectDir: string,
  agentName?: string,
): Promise<AgentKey | null> {
  // Real paths on both sides: a project under a symlinked parent (macOS's
  // /var → /private/var, a linked workspace) is one directory spelled two
  // ways, and the pairing must be found under either spelling.
  const real = (p: string) => realpath(resolve(p)).catch(() => resolve(p));
  const at = await real(projectDir);
  const wanted = instance.replace(/\/+$/, "");
  const entries = Object.values((await read()).keys ?? {}).filter(
    (k) => k.instance.replace(/\/+$/, "") === wanted,
  );
  const held: AgentKey[] = [];
  for (const k of entries) if ((await real(k.project)) === at) held.push(k);
  if (agentName) {
    const forAgent = held.filter((k) => k.agent?.toLowerCase() === agentName.toLowerCase());
    if (forAgent.length > 0) return forAgent[forAgent.length - 1]!;
    const generic = held.filter((k) => !k.agent);
    if (generic.length > 0) return generic[generic.length - 1]!;
    return null;
  }
  return held[held.length - 1] ?? null;
}

/** Every key this machine holds — what `reset` has to be able to describe
 *  before it forgets it, and what tells somebody which projects go quiet. */
export async function agentKeys(): Promise<AgentKey[]> {
  return Object.values((await read()).keys ?? {});
}

export async function forgetAgentKey(instance: string, keyId: string): Promise<boolean> {
  const store = await read();
  const at = handle(instance, keyId);
  if (!store.keys?.[at]) return false;
  const { [at]: _gone, ...rest } = store.keys;
  await write({ keys: rest });
  return true;
}
