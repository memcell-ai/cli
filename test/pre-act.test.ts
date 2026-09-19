import { describe, expect, it } from "vitest";
import { evaluatePreAct, stageStatementsFromRecall } from "../src/loop/pre-act.js";
import { SURFACE as claudeSurface } from "../src/adapters/claude.js";
import { can, type Guard } from "../src/adapters/surface.js";

const guard = (() => {
  if (!can(claudeSurface.guard)) throw new Error("claude code documents PreToolUse");
  return claudeSurface.guard as Guard;
})();

describe("stageStatementsFromRecall", () => {
  it("stages #guard statements in strict mode as hard refusal gates", () => {
    const statements = [
      {
        id: "s-1",
        title: "Never force push to main",
        context: "Main branch history is immutable.",
        tags: ["git", "guard"],
        confidence: 0.95,
      },
    ];

    const staged = stageStatementsFromRecall(statements, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      statementId: "s-1",
      title: "Never force push to main",
      refuses: true,
      appliesAt: ["change", "record", "send"],
    });
  });

  it("degrades #guard statements in advisory mode to soft advisories (refuses: false)", () => {
    const statements = [
      {
        id: "s-2",
        title: "Never force push to main",
        context: "Main branch history is immutable.",
        tags: ["git", "guard"],
        confidence: 0.95,
      },
    ];

    const staged = stageStatementsFromRecall(statements, "advisory");
    expect(staged).toHaveLength(1);
    expect(staged[0]!.refuses).toBe(false);
  });

  it("stages #convention statements as soft advisories regardless of guardMode", () => {
    const statements = [
      {
        id: "s-3",
        title: "Use pnpm instead of npm",
        context: "Workspace dependencies are managed via pnpm workspaces.",
        tags: ["tooling", "convention"],
        confidence: 0.85,
      },
    ];

    const stagedStrict = stageStatementsFromRecall(statements, "strict");
    expect(stagedStrict).toHaveLength(1);
    expect(stagedStrict[0]!.refuses).toBe(false);
    expect(stagedStrict[0]!.appliesAt).toEqual(["change", "record"]);

    const stagedAdvisory = stageStatementsFromRecall(statements, "advisory");
    expect(stagedAdvisory[0]!.refuses).toBe(false);
  });

  it("honors specific act class tags when present", () => {
    const statements = [
      {
        id: "s-4",
        title: "Audit all external API calls",
        context: "Send requests through proxy.",
        tags: ["security", "guard", "send"],
        confidence: 0.9,
      },
    ];

    const staged = stageStatementsFromRecall(statements, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!.appliesAt).toEqual(["send"]);
    expect(staged[0]!.refuses).toBe(true);
  });

  it("discards pure knowledge statements without action triggers", () => {
    const statements = [
      {
        id: "s-5",
        title: "Architecture uses PostgreSQL and Drizzle",
        context: "All models are in src/db/schema.",
        tags: ["architecture", "database"],
        confidence: 0.8,
      },
    ];

    const staged = stageStatementsFromRecall(statements, "strict");
    expect(staged).toHaveLength(0);
  });

  it("correctly normalizes legacy statement objects", () => {
    const legacyResults = [
      {
        statementId: "s-legacy",
        text: "Always run tests before committing.",
        confidence: 0.9,
        appliesAt: ["record"],
        refuses: true,
      },
    ];

    const staged = stageStatementsFromRecall(legacyResults, "strict");
    expect(staged).toHaveLength(1);
    expect(staged[0]!).toMatchObject({
      statementId: "s-legacy",
      appliesAt: ["record"],
      refuses: true,
    });
  });
});

describe("evaluatePreAct", () => {
  const strictGuardRule = {
    statementId: "g-1",
    title: "Never push directly to production branch",
    text: "Never push directly to production branch: git push must go through PR.",
    tags: ["git", "guard"],
    appliesAt: ["send" as const],
    refuses: true,
  };

  const conventionRule = {
    statementId: "c-1",
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
      standingRules: [strictGuardRule],
    });
    expect(result.verdict).toBe("pass");
  });

  it("returns pass when tool action does not match any standing rule appliesAt", () => {
    // Read action (e.g. git status) should not trigger send guard
    const result = evaluatePreAct({
      tool: "Bash",
      input: { command: "git status" },
      guard,
      standingRules: [strictGuardRule],
    });
    expect(result.verdict).toBe("pass");
  });

  it("refuses destructive act when matching a hard refusal guard in strict mode", () => {
    // Send action (e.g. git push origin main) matches send guard
    const result = evaluatePreAct({
      tool: "Bash",
      input: { command: "git push origin main" },
      guard,
      standingRules: [strictGuardRule],
    });

    expect(result.verdict).toBe("refuse");
    if (result.verdict === "refuse") {
      expect(result.act).toBe("send");
      expect(result.reason).toContain("Never push directly to production branch");
      expect(result.stops).toHaveLength(1);
      expect(result.pairs).toEqual([
        {
          statementId: "g-1",
          act: "send",
          tool: "Bash",
          became: "refused",
        },
      ]);
    }
  });

  it("provides soft guidance when matching an advisory rule", () => {
    // Change action (e.g. Edit tool) matches convention
    const result = evaluatePreAct({
      tool: "Edit",
      input: { file_path: "src/index.ts" },
      guard,
      standingRules: [conventionRule],
    });

    expect(result.verdict).toBe("advise");
    if (result.verdict === "advise") {
      expect(result.act).toBe("change");
      expect(result.guidance).toContain("Follow strict TypeScript conventions");
      expect(result.pairs).toEqual([
        {
          statementId: "c-1",
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
      standingRules: [conventionRule],
      firedMap: { "said:change": Date.now() },
    });

    expect(result.verdict).toBe("pass");
  });

  it("completes evaluation in sub-millisecond time (< 1ms)", () => {
    const rules = [strictGuardRule, conventionRule];
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluatePreAct({
        tool: "Bash",
        input: { command: "git push origin main" },
        guard,
        standingRules: rules,
      });
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 1000;
    // Average evaluation time must be well under 1.0ms (typically ~0.005ms)
    expect(avgMs).toBeLessThan(0.1);
  });
});
