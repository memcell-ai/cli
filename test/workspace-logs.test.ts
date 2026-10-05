import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const home = mkdtempSync(join(tmpdir(), "memcell-log-home-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const { log, projectDir, projectLogFile } = await import("../src/loop/session.js");

describe("project-scoped logging", () => {
  it("resolves project directories under ~/.memcell/projects", () => {
    expect(projectDir({ owner: "alice", project: "app" })).toBe(
      join(home, ".memcell", "projects", "alice", "app"),
    );
    expect(projectDir({ space: "my-space" })).toBe(join(home, ".memcell", "projects", "my-space"));
    expect(projectDir("bob/backend")).toBe(join(home, ".memcell", "projects", "bob", "backend"));
    expect(projectDir()).toBe(join(home, ".memcell"));
  });

  it("resolves project log files to hook.log inside project directory", () => {
    expect(projectLogFile({ owner: "alice", project: "app" })).toBe(
      join(home, ".memcell", "projects", "alice", "app", "hook.log"),
    );
    expect(projectLogFile()).toBe(join(home, ".memcell", "hook.log"));
  });

  it("writes logs into isolated project directories", async () => {
    await log("alice firing 1", { owner: "alice", project: "frontend" });
    await log("alice firing 2", { owner: "alice", project: "frontend" });
    await log("bob firing 1", { owner: "bob", project: "backend" });
    await log("unscoped firing 1");

    const aliceLog = readFileSync(
      join(home, ".memcell", "projects", "alice", "frontend", "hook.log"),
      "utf8",
    );
    const bobLog = readFileSync(
      join(home, ".memcell", "projects", "bob", "backend", "hook.log"),
      "utf8",
    );
    const globalLog = readFileSync(join(home, ".memcell", "hook.log"), "utf8");

    expect(aliceLog).toContain("alice firing 1");
    expect(aliceLog).toContain("alice firing 2");
    expect(aliceLog).not.toContain("bob firing");
    expect(aliceLog).not.toContain("unscoped firing");

    expect(bobLog).toContain("bob firing 1");
    expect(bobLog).not.toContain("alice firing");

    expect(globalLog).toContain("unscoped firing 1");
    expect(globalLog).not.toContain("alice firing");
    expect(globalLog).not.toContain("bob firing");
  });

  it("sanitizes unsafe characters in project and owner names", async () => {
    await log("safe firing", { owner: "org../unsafe", project: "../../pwn" });
    const resolved = projectLogFile({ owner: "org../unsafe", project: "../../pwn" });
    expect(resolved).not.toContain("..");
    expect(resolved.startsWith(join(home, ".memcell", "projects"))).toBe(true);
  });
});
