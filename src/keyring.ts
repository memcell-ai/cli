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
  /** The wired agent's own id — personal, like the key, so it lives here
   *  rather than in the committed project file. */
  agentId?: string;
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

export async function saveAgentKey(entry: AgentKey): Promise<void> {
  const store = await read();
  await write({
    keys: {
      ...store.keys,
      [handle(entry.instance, entry.keyId)]: { ...entry, project: resolve(entry.project) },
    },
  });
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
