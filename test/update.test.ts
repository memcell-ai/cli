import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkUpdate,
  isNewerVersion,
  readUpdateCache,
  shouldCheckForUpdates,
  writeUpdateCache,
} from "../src/update.js";

describe("update", () => {
  let tempDir: string;
  let cacheFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memcell-update-test-"));
    cacheFile = join(tempDir, "update.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  describe("isNewerVersion", () => {
    it("detects patch increments", () => {
      expect(isNewerVersion("0.10.9", "0.10.8")).toBe(true);
      expect(isNewerVersion("0.10.8", "0.10.9")).toBe(false);
      expect(isNewerVersion("0.10.8", "0.10.8")).toBe(false);
    });

    it("detects minor and major increments", () => {
      expect(isNewerVersion("0.11.0", "0.10.8")).toBe(true);
      expect(isNewerVersion("1.0.0", "0.10.8")).toBe(true);
      expect(isNewerVersion("0.9.9", "0.10.8")).toBe(false);
    });

    it("handles leading 'v' and prerelease tags", () => {
      expect(isNewerVersion("v0.11.0", "0.10.8")).toBe(true);
      expect(isNewerVersion("0.11.0-alpha.1", "0.10.8")).toBe(true);
    });
  });

  describe("shouldCheckForUpdates", () => {
    const originalEnv = { ...process.env };
    const originalIsTTY = process.stdout.isTTY;

    afterEach(() => {
      process.env = { ...originalEnv };
      process.stdout.isTTY = originalIsTTY;
    });

    it("suppresses check when stdout is not a TTY", () => {
      process.stdout.isTTY = false;
      expect(shouldCheckForUpdates(["status"])).toBe(false);
    });

    it("suppresses check for hook commands even if in a TTY", () => {
      process.stdout.isTTY = true;
      delete process.env.CI;
      delete process.env.MEMCELL_NO_UPDATE_NOTIFIER;
      expect(shouldCheckForUpdates(["hook", "prompt-submit", "claude"])).toBe(false);
      expect(shouldCheckForUpdates(["hook"])).toBe(false);
    });

    it("suppresses check for mcp command even if in a TTY", () => {
      process.stdout.isTTY = true;
      delete process.env.CI;
      delete process.env.MEMCELL_NO_UPDATE_NOTIFIER;
      expect(shouldCheckForUpdates(["mcp"])).toBe(false);
    });

    it("suppresses check when CI or MEMCELL_NO_UPDATE_NOTIFIER is set", () => {
      process.stdout.isTTY = true;
      process.env.CI = "true";
      expect(shouldCheckForUpdates(["status"])).toBe(false);

      delete process.env.CI;
      process.env.MEMCELL_NO_UPDATE_NOTIFIER = "1";
      expect(shouldCheckForUpdates(["status"])).toBe(false);
    });

    it("permits check for interactive human-facing commands", () => {
      process.stdout.isTTY = true;
      delete process.env.CI;
      delete process.env.MEMCELL_NO_UPDATE_NOTIFIER;
      expect(shouldCheckForUpdates(["status"])).toBe(true);
      expect(shouldCheckForUpdates(["connect"])).toBe(true);
      expect(shouldCheckForUpdates(["statements"])).toBe(true);
    });
  });

  describe("cache reading and writing", () => {
    it("reads null when cache does not exist", async () => {
      expect(await readUpdateCache(cacheFile)).toBeNull();
    });

    it("writes and reads back cache faithfully", async () => {
      const now = Date.now();
      await writeUpdateCache({ lastChecked: now, latestVersion: "0.10.9" }, cacheFile);

      const read = await readUpdateCache(cacheFile);
      expect(read).toEqual({
        lastChecked: now,
        latestVersion: "0.10.9",
      });
    });

    it("returns null for corrupt cache", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(cacheFile, "corrupt json{{{", "utf8");
      expect(await readUpdateCache(cacheFile)).toBeNull();
    });
  });

  describe("checkUpdate", () => {
    const originalEnv = { ...process.env };
    const originalIsTTY = process.stdout.isTTY;

    beforeEach(() => {
      process.stdout.isTTY = true;
      delete process.env.CI;
      delete process.env.MEMCELL_NO_UPDATE_NOTIFIER;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      process.stdout.isTTY = originalIsTTY;
    });

    it("returns newer version when cache has one", async () => {
      await writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.11.0" }, cacheFile);

      const result = await checkUpdate("0.10.8", ["status"], cacheFile);
      expect(result).toBe("0.11.0");
    });

    it("returns null when current version is up to date", async () => {
      await writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.10.8" }, cacheFile);

      const result = await checkUpdate("0.10.8", ["status"], cacheFile);
      expect(result).toBeNull();
    });

    it("returns null for hook command", async () => {
      await writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.11.0" }, cacheFile);

      const result = await checkUpdate("0.10.8", ["hook", "turn-end"], cacheFile);
      expect(result).toBeNull();
    });
  });
});
