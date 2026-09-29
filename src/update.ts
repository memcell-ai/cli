import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { machineFile } from "./machine.js";
import { badge, blank, cmd, label, row, say, value, warn } from "./ui.js";

export interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

export const UPDATE_CACHE_FILE = machineFile("update.json");
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compares two semver strings (e.g. "0.10.9" vs "0.10.8").
 * Returns true if latest is strictly newer than current.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split("-")[0]!
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const [lMaj = 0, lMin = 0, lPatch = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPatch = 0] = parse(current);

  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

/**
 * Reads cached update state from disk. Returns null on any failure.
 */
export async function readUpdateCache(
  filePath: string = UPDATE_CACHE_FILE,
): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UpdateCache;
    if (typeof parsed.lastChecked === "number" && typeof parsed.latestVersion === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes update cache to disk. Fails silently.
 */
export async function writeUpdateCache(
  cache: UpdateCache,
  filePath: string = UPDATE_CACHE_FILE,
): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Fail silently
  }
}

/**
 * Queries npm registry for the latest released version with a 1.5s timeout.
 */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/memcell/latest", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether this command invocation should perform update checking.
 * Strictly suppressed for machine-facing commands (hook, mcp), non-interactive TTYs, and CI.
 */
export function shouldCheckForUpdates(commandPath?: string[]): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR && !process.stdout.isTTY) return false;
  if (
    process.env.CI === "1" ||
    process.env.CI === "true" ||
    process.env.MEMCELL_NO_UPDATE_NOTIFIER
  ) {
    return false;
  }
  const top = commandPath?.[0];
  if (top === "hook" || top === "mcp") return false;
  return true;
}

/**
 * Prints a clean, non-intrusive update notice to the terminal.
 */
export function printUpdateNotice(current: string, latest: string): void {
  say(
    blank(),
    row(0, [badge("memcell"), warn("update available")], [value(`${current} → ${latest}`)]),
    row(1, [label("run")], [cmd("npm install -g memcell")]),
  );
}

/**
 * Asynchronously checks if a newer version is available.
 * Uses cached version to respond in ~0ms without blocking.
 * Triggers non-blocking background fetch if cache is older than 24 hours.
 */
export async function checkUpdate(
  currentVersion: string,
  commandPath?: string[],
  filePath: string = UPDATE_CACHE_FILE,
): Promise<string | null> {
  if (!shouldCheckForUpdates(commandPath)) return null;

  const cached = await readUpdateCache(filePath);
  const now = Date.now();

  if (!cached || now - cached.lastChecked > ONE_DAY_MS) {
    void fetchLatestVersion().then(async (latest) => {
      if (latest) {
        await writeUpdateCache({ lastChecked: Date.now(), latestVersion: latest }, filePath);
      }
    });
  }

  if (cached && isNewerVersion(cached.latestVersion, currentVersion)) {
    return cached.latestVersion;
  }

  return null;
}
