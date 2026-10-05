import { describe, expect, it } from "vitest";
import { evaluatePreAct, stageMemoriesFromRecall } from "../src/loop/pre-act.js";
import { SURFACE as claudeSurface } from "../src/adapters/claude.js";
import { can, type Guard } from "../src/adapters/surface.js";

const guard = (() => {
  if (!can(claudeSurface.guard)) throw new Error("claude code documents PreToolUse");
  return claudeSurface.guard as Guard;
})();

describe("stageMemoriesFromRecall", () => {
  it("stages #guard memories in strict mode as hard refusal gates", () => {
    const memories = [
      {
        id: "s-1",
        title: "Never force push to main",
        context: "Main branch history is immutable.",
        tags: ["git", "guard"],
        confidence: 0.95,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      memoryId: "s-1",
      title: "Never force push to main",
      refuses: true,
      appliesAt: ["change", "record", "send"],
    });
  });

  it("degrades #guard memories in advisory mode to soft advisories (refuses: false)", () => {
    const memories = [
      {
        id: "s-2",
        title: "Never force push to main",
        context: "Main branch history is immutable.",
        tags: ["git", "guard"],
        confidence: 0.95,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "advisory");
    expect(staged).toHaveLength(1);
    expect(staged[0]!.refuses).toBe(false);
  });

  it("stages #convention memories as soft advisories regardless of guardMode", () => {
    const memories = [
      {
        id: "s-3",
        title: "Use pnpm instead of npm",
        context: "Workspace dependencies are managed via pnpm workspaces.",
        tags: ["tooling", "convention"],
        confidence: 0.85,
      },
    ];

    const stagedStrict = stageMemoriesFromRecall(memories, "strict");
    expect(stagedStrict).toHaveLength(1);
    expect(stagedStrict[0]!.refuses).toBe(false);
    expect(stagedStrict[0]!.appliesAt).toEqual(["change", "record"]);

    const stagedAdvisory = stageMemoriesFromRecall(memories, "advisory");
    expect(stagedAdvisory[0]!.refuses).toBe(false);
  });

  it("honors specific act class tags when present", () => {
    const memories = [
      {
        id: "s-4",
        title: "Audit all external API calls",
        context: "Send requests through proxy.",
        tags: ["security", "guard", "send"],
        confidence: 0.9,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!.appliesAt).toEqual(["send"]);
    expect(staged[0]!.refuses).toBe(true);
  });

  it("discards pure knowledge memories without action triggers", () => {
    const memories = [
      {
        id: "s-5",
        title: "Architecture uses PostgreSQL and Drizzle",
        context: "All models are in src/db/schema.",
        tags: ["architecture", "database"],
        confidence: 0.8,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "strict");
    expect(staged).toHaveLength(0);
  });

  it("stages memories with type === 'guard' as hard refusal gates in strict mode", () => {
    const memories = [
      {
        id: "s-guard-type",
        title: "Never drop production tables",
        type: "guard",
        confidence: 0.95,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      memoryId: "s-guard-type",
      title: "Never drop production tables",
      refuses: true,
      appliesAt: ["change", "record", "send"],
    });
  });

  it("stages memories with type === 'directive' as soft advisories (refuses: false) even in strict mode", () => {
    const memories = [
      {
        id: "s-directive",
        title: "Always verify output before executing",
        type: "directive",
        confidence: 0.9,
      },
    ];

    const staged = stageMemoriesFromRecall(memories, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      memoryId: "s-directive",
      title: "Always verify output before executing",
      refuses: false,
      appliesAt: ["change", "record"],
    });
  });

  it("correctly normalizes memory objects", () => {
    const memoryResults = [
      {
        memoryId: "s-mem",
        text: "Always run tests before committing.",
        confidence: 0.9,
        appliesAt: ["record"],
        refuses: true,
      },
    ];

    const staged = stageMemoriesFromRecall(memoryResults, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      memoryId: "s-mem",
      appliesAt: ["record"],
      refuses: true,
    });
  });
});

describe("evaluatePreAct", () => {
  const strictGuardMemory = {
    memoryId: "g-1",
    title: "Never push directly to production branch",
    text: "Never push directly to production branch: git push must go through PR.",
    tags: ["git", "guard"],
    appliesAt: ["send" as const],
    refuses: true,
  };

  const conventionMemory = {
    memoryId: "c-1",
    title: "Follow strict TypeScript conventions",
    text: "Follow strict TypeScript conventions: no explicit any.",
    tags: ["typescript", "convention"],
    appliesAt: ["change" as const],
    refuses: false,
  };

  it("returns pass when tool or guard is missing or unrecognized", () => {
    const result = evaluatePreAct({
      tool: "",
      input: {},
      guard,
      activeMemories: [strictGuardMemory],
    });
    expect(result.verdict).toBe("pass");
  });

  it("returns pass when tool action does not match any memory appliesAt", () => {
    // Read action (e.g. git status) should not trigger send guard
    const result = evaluatePreAct({
      tool: "Bash",
      input: { command: "git status" },
      guard,
      activeMemories: [strictGuardMemory],
    });
    expect(result.verdict).toBe("pass");
  });

  it("refuses destructive act when matching a hard refusal guard in strict mode", () => {
    // Send action (e.g. git push origin main) matches send guard
    const result = evaluatePreAct({
      tool: "Bash",
      input: { command: "git push origin main" },
      guard,
      activeMemories: [strictGuardMemory],
    });

    expect(result.verdict).toBe("refuse");
    if (result.verdict === "refuse") {
      expect(result.act).toBe("send");
      expect(result.reason).toContain("Never push directly to production branch");
      expect(result.stops).toHaveLength(1);
      expect(result.pairs).toEqual([
        {
          memoryId: "g-1",
          act: "send",
          tool: "Bash",
          became: "refused",
        },
      ]);
    }
  });

  it("provides soft guidance and never refuses when executing tools with an advisory directive", () => {
    const directiveMemory = {
      memoryId: "d-1",
      title: "Always verify output before executing",
      text: "Always verify output before executing: systematically validate before triggering.",
      tags: ["workflow"],
      appliesAt: ["change" as const],
      refuses: false,
    };

    const result = evaluatePreAct({
      tool: "Edit",
      input: { file_path: "src/index.ts" },
      guard,
      activeMemories: [directiveMemory],
    });

    expect(result.verdict).toBe("advise");
    if (result.verdict === "advise") {
      expect(result.act).toBe("change");
      expect(result.guidance).toContain("Always verify output before executing");
      expect(result.bears[0]!.refuses).toBe(false);
      expect(result.pairs).toEqual([
        {
          memoryId: "d-1",
          act: "change",
          tool: "Edit",
          became: "served",
        },
      ]);
    }
  });

  it("provides soft guidance when matching an advisory memory", () => {
    // Change action (e.g. Edit tool) matches convention
    const result = evaluatePreAct({
      tool: "Edit",
      input: { file_path: "src/index.ts" },
      guard,
      activeMemories: [conventionMemory],
    });

    expect(result.verdict).toBe("advise");
    if (result.verdict === "advise") {
      expect(result.act).toBe("change");
      expect(result.guidance).toContain("Follow strict TypeScript conventions");
      expect(result.pairs).toEqual([
        {
          memoryId: "c-1",
          act: "change",
          tool: "Edit",
          became: "served",
        },
      ]);
    }
  });

  it("suppresses repeated soft advisory when already fired in session", () => {
    const result = evaluatePreAct({
      tool: "Edit",
      input: { file_path: "src/index.ts" },
      guard,
      activeMemories: [conventionMemory],
      firedMap: { "said:change": Date.now() },
    });

    expect(result.verdict).toBe("pass");
  });

  it("completes evaluation in sub-millisecond time (< 1ms)", () => {
    const memories = [strictGuardMemory, conventionMemory];
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluatePreAct({
        tool: "Bash",
        input: { command: "git push origin main" },
        guard,
        activeMemories: memories,
      });
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 1000;
    // Average evaluation time must be well under 1.0ms (typically ~0.005ms)
    expect(avgMs).toBeLessThan(0.1);
  });
});
