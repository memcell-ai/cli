import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A public repo carries no internal voicing: no phase markers or codenames,
// no pointers to documents that are not in this repo, no business language.

const BANNED = [
  /\bphase\s+\d/i,
  /\blane\s*\d/i,
  /\bBUILD\.md\b/,
  /\bfour lanes?\b/i,
  /\bfunnel\b/i,
  /\block-?in\b/i,
  /\bcompetitor/i,
  /\bmoat\b/i,
  /\bICP\b/,
  /\bgo[- ]to[- ]market\b/i,
  /claude\.ai\/code/,
  /openori-org/,
];

async function* files(at: string): AsyncGenerator<string> {
  for (const entry of await readdir(at, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    if (entry.name === "public-surface.test.ts") continue; // the patterns would match themselves
    const full = join(at, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(ts|md|json|yml)$/.test(entry.name)) yield full;
  }
}

describe("everything here is read by strangers", () => {
  it("no file carries internal voicing", async () => {
    const offenders: string[] = [];
    const root = join(__dirname, "..");
    for await (const file of files(root)) {
      const text = await readFile(file, "utf8");
      for (const pattern of BANNED) {
        if (pattern.test(text)) offenders.push(`${file.slice(root.length + 1)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
