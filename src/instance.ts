import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { text } from "./config.js";
import { machineDir } from "./machine.js";

// Where this machine keeps what it knows: which memcell it talks to, and
// the session it holds there.
//
// The instance is part of the credential, never a separate setting — a
// token minted against a laptop's dev server must never be presentable to
// memcell.ai. So they are stored together, per instance, and every command
// resolves both in one step.

export const DEFAULT_INSTANCE = "https://memcell.ai";

export interface Credential {
  instance: string;
  token: string;
  /** ISO — what the session said when it was stored. */
  obtainedAt: string;
}

interface Store {
  current?: string;
  credentials?: Record<string, Credential>;
}

const dir = machineDir;
const file = () => join(dir(), "credentials.json");

/** Trailing slashes are a foot-gun once these become URL prefixes. */
export function normalize(instance: string): string {
  return instance.replace(/\/+$/, "");
}

/**
 * Whether this could be an instance at all.
 *
 * A typo in `--instance` used to be carried all the way down and surface as
 * "not signed in · run memcell login" — sending somebody to sign in to
 * something that cannot exist. Caught once, where the instance is decided,
 * so every command refuses the same way.
 */
export function badInstance(instance: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(instance);
  } catch {
    return `${instance} is not a URL · try http://localhost:3000`;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? null
    : `${instance} is not http or https`;
}

async function read(): Promise<Store> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Store;
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(dir(), { recursive: true });
  // The token is a live session: keep it off other users' eyes.
  await writeFile(file(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Which memcell this invocation talks to — the first setting to go through
 * the config chain, and the reason that chain exists.
 *
 * `--instance` · MEMCELL_INSTANCE · the project's `instance` · the
 * machine's `instance` · whatever was last connected · the hosted one.
 * The last-connected fallback stays beneath config on purpose: it is a
 * memory of what happened, and a setting somebody wrote is a statement of
 * what they want.
 */
export async function resolveInstance(flag?: string): Promise<string> {
  const configured = await text("instance.url", "", flag);
  if (configured.value) return normalize(configured.value);
  const store = await read();
  return normalize(store.current ?? DEFAULT_INSTANCE);
}

/** The same answer, with what decided it — for the commands that say where
 *  they are pointed and why. */
export async function whereInstance(flag?: string): Promise<{ instance: string; from: string }> {
  const configured = await text("instance.url", "", flag);
  if (configured.value) return { instance: normalize(configured.value), from: configured.scope };
  const store = await read();
  return store.current
    ? { instance: normalize(store.current), from: "last connected" }
    : { instance: DEFAULT_INSTANCE, from: "default" };
}

export async function credentialFor(instance: string): Promise<Credential | null> {
  const store = await read();
  return store.credentials?.[normalize(instance)] ?? null;
}

export async function saveCredential(credential: Credential): Promise<void> {
  const store = await read();
  const instance = normalize(credential.instance);
  await write({
    current: instance,
    credentials: { ...store.credentials, [instance]: { ...credential, instance } },
  });
}

export async function forgetCredential(instance: string): Promise<boolean> {
  const store = await read();
  const key = normalize(instance);
  if (!store.credentials?.[key]) return false;
  const { [key]: _gone, ...rest } = store.credentials;
  await write({
    current: store.current === key ? Object.keys(rest)[0] : store.current,
    credentials: rest,
  });
  return true;
}

export async function knownInstances(): Promise<string[]> {
  return Object.keys((await read()).credentials ?? {});
}
