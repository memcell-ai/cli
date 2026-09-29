import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rememberedCalls: any[] = [];
const mockSdk = {
  remember: vi.fn(async (params: any) => {
    rememberedCalls.push(params);
    return {
      created: [{ id: "stmt-1", title: "Atomic statement" }],
      reinforced: [],
    };
  }),
};

vi.mock("../src/sdk-client.js", () => ({
  getSdkClient: vi.fn(async () => mockSdk),
}));

const mockWiredState = {
  current: null as {
    instance: string;
    space: string;
    key: string;
    root: string;
  } | null,
};

vi.mock("../src/commands/wired.js", () => ({
  wired: vi.fn(async () => mockWiredState.current),
}));

const { importFiles } = await import("../src/commands/import.js");

describe("memcell import command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memcell-import-cmd-"));
    rememberedCalls.length = 0;
    mockSdk.remember.mockClear();
    mockWiredState.current = {
      instance: "https://api.memcell.io",
      space: "test-owner/test-proj",
      key: "mem_agent_key_123",
      root: tempDir,
    };
  });

  it("previews discovered files in dry-run mode without calling sdk.remember", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# Guidelines\nAlways write tests.");
    await writeFile(join(tempDir, "GEMINI.md"), "# Rules\nMaintain types.");

    const res = await importFiles({
      dryRun: true,
      scope: "common",
      type: "directive",
    });

    expect(res).toBe(0);
    expect(mockSdk.remember).not.toHaveBeenCalled();
    expect(rememberedCalls).toHaveLength(0);
  });

  it("outputs structured JSON in --json mode", async () => {
    await writeFile(join(tempDir, "AGENTS.md"), "# Instructions\nWork autonomously.");

    let captured = "";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      captured += String(chunk);
      return true;
    });

    const res = await importFiles({
      dryRun: true,
      json: true,
    });

    expect(res).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    const parsed = JSON.parse(captured.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.space).toBe("test-owner/test-proj");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].status).toBe("preview");

    stdoutSpy.mockRestore();
  });

  it("distills files with custom scope and type into SDK remember", async () => {
    const filePath = join(tempDir, "policy.md");
    await writeFile(filePath, "# Safety Policy\nNever delete production database.");

    const res = await importFiles({
      files: [filePath],
      scope: "security",
      type: "guard",
    });

    expect(res).toBe(0);
    expect(mockSdk.remember).toHaveBeenCalledTimes(1);
    expect(rememberedCalls[0]).toMatchObject({
      namespace: "test-owner/test-proj",
      raw: "# Safety Policy\nNever delete production database.",
      type: "guard",
      scope: "security",
    });
    expect(rememberedCalls[0].metadata?.origin).toBeDefined();
  });

  it("handles unreadable files gracefully without crashing", async () => {
    const missingFile = join(tempDir, "does-not-exist.md");

    const res = await importFiles({
      files: [missingFile],
    });

    expect(res).toBe(1);
    expect(mockSdk.remember).not.toHaveBeenCalled();
  });
});
