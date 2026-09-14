import type { Guard, ActClass } from "../adapters/surface.js";
import { actOf } from "./act.js";
import type { ActiveRule, StandingRule } from "./session.js";

const VALID_ACTS: ActClass[] = ["read", "change", "record", "send", "answer"];

export function isActClass(val: string): val is ActClass {
  return VALID_ACTS.includes(val as ActClass);
}

export interface RawStatementInput {
  id?: string;
  statementId?: string;
  title?: string;
  text?: string;
  context?: string | null;
  example?: string | null;
  tags?: string[];
  confidence?: number;
  stability?: number;
  reinforcementCount?: number;
  appliesAt?: string[];
  refuses?: boolean;
  kind?: string;
  layer?: string;
  contested?: boolean;
  diverged?: boolean;
  violated?: boolean;
  vouched?: boolean;
  verified?: boolean;
}

/**
 * Normalizes statements from recall (both modern Knowledge Triads and legacy results)
 * and stages rules bearing on actions into standing rules.
 */
export function stageRulesFromRecall(
  statements: RawStatementInput[],
  guardMode: "strict" | "advisory" = "strict",
): StandingRule[] {
  const staged: StandingRule[] = [];

  for (const stmt of statements) {
    const statementId = stmt.id ?? stmt.statementId;
    if (!statementId) continue;

    const title = stmt.title ?? stmt.text ?? "";
    const context = stmt.context ?? "";
    const text = stmt.title
      ? context
        ? `${stmt.title}: ${context}`
        : stmt.title
      : (stmt.text ?? "");
    const tags = Array.isArray(stmt.tags) ? stmt.tags.map((t) => t.toLowerCase()) : [];

    // 1. Determine if this rule is a Guard vs. Convention vs. General Knowledge
    const hasGuardTag = tags.includes("guard") || tags.includes("security");
    const isExplicitGuard =
      hasGuardTag || stmt.refuses === true || stmt.kind === "dead_end" || stmt.kind === "gotcha";

    const isExplicitConvention =
      tags.includes("convention") ||
      tags.includes("style") ||
      tags.includes("guideline") ||
      stmt.kind === "convention";

    // 2. Determine target ActClasses (appliesAt)
    let appliesAt: ActClass[] = [];

    // Check explicit appliesAt field
    if (Array.isArray(stmt.appliesAt) && stmt.appliesAt.length > 0) {
      appliesAt = stmt.appliesAt.filter(isActClass);
    }

    // Check tags for act classes (e.g. #change, #send, #read, #record, #answer)
    const actsFromTags = tags.filter(isActClass);
    if (actsFromTags.length > 0) {
      appliesAt = Array.from(new Set([...appliesAt, ...actsFromTags]));
    }

    // If no explicit acts declared, apply intelligent defaults based on rule category
    if (appliesAt.length === 0) {
      if (isExplicitGuard) {
        // Guard defaults to modifying / durable / external acts
        appliesAt = ["change", "record", "send"];
      } else if (isExplicitConvention) {
        // Convention defaults to code modifications and commits
        appliesAt = ["change", "record"];
      }
    }

    // If rule doesn't bear on any acts, it's general knowledge and not staged for tool-time
    if (appliesAt.length === 0) {
      continue;
    }

    // 3. Determine refusal behavior based on guardMode:
    // A rule is a hard refusal gate ONLY if it has the #guard tag or stmt.refuses === true,
    // AND guardMode is "strict".
    // In "advisory" mode, #guard rules degrade to soft warnings (refuses: false).
    // Conventions and unflagged standing rules are always soft advisories.
    const isGuardGate = hasGuardTag || stmt.refuses === true;
    const refuses = isGuardGate && guardMode === "strict";

    staged.push({
      statementId,
      title: stmt.title ?? title,
      text,
      tags,
      appliesAt,
      refuses,
    });
  }

  return staged;
}

export interface PreActOptions {
  tool: string;
  input: Record<string, unknown> | undefined;
  guard: Guard;
  activeRules?: ActiveRule[];
  standingRules?: StandingRule[];
  firedMap?: Record<string, number>;
}

export type PreActResult =
  | { verdict: "pass" }
  | {
      verdict: "refuse";
      act: ActClass;
      reason: string;
      stops: ActiveRule[];
      pairs: { statementId: string; act: string; tool: string; became: string }[];
    }
  | {
      verdict: "advise";
      act: ActClass;
      guidance: string;
      bears: ActiveRule[];
      pairs: { statementId: string; act: string; tool: string; became: string }[];
    };

/**
 * Fast in-memory Pre-Act Guard evaluator (< 1ms).
 * Decides whether to refuse, advise, or pass before a tool call.
 */
export function evaluatePreAct(options: PreActOptions): PreActResult {
  const { tool, input, guard, firedMap = {} } = options;
  const rules = options.activeRules ?? options.standingRules ?? [];

  if (!tool || !guard) {
    return { verdict: "pass" };
  }

  const act = actOf(tool, input, guard);
  if (!act) {
    return { verdict: "pass" };
  }

  const bears = rules.filter((r) => r.appliesAt.includes(act));
  if (bears.length === 0) {
    return { verdict: "pass" };
  }

  // 1. Check for hard refusals (Hard Gates)
  const stops = bears.filter((r) => r.refuses);
  if (stops.length > 0) {
    const reason = stops.map((r) => r.text || r.title).join(" · ");
    const pairs = stops.map((r) => ({
      statementId: r.statementId,
      act,
      tool,
      became: "refused",
    }));

    return {
      verdict: "refuse",
      act,
      reason,
      stops,
      pairs,
    };
  }

  // 2. Soft Guidance (Advisories)
  // Check if already fired for this act in this session (avoid spamming every edit/command)
  const saidKey = `said:${act}`;
  if (firedMap[saidKey]) {
    return { verdict: "pass" };
  }

  const guidance = [
    `memcell — standing here, for what you are about to do:`,
    ...bears.map((r) => `· ${r.text || r.title}`),
  ].join("\n");

  const pairs = bears.map((r) => ({
    statementId: r.statementId,
    act,
    tool,
    became: "served",
  }));

  return {
    verdict: "advise",
    act,
    guidance,
    bears,
    pairs,
  };
}
