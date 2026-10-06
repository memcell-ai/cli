import type { Guard, ActClass } from "../adapters/surface.js";
import { actOf } from "./act.js";
import type { ActiveMemory } from "./session.js";

const VALID_ACTS: ActClass[] = ["read", "change", "record", "send", "answer"];

export function isActClass(val: string): val is ActClass {
  return VALID_ACTS.includes(val as ActClass);
}

export interface RawMemoryInput {
  id?: string;
  memoryId?: string;
  title?: string;
  text?: string;
  context?: string | null;
  observation?: string | null;
  enforce?: boolean;
  tags?: string[];
  confidence?: number;
  stability?: number;
  reinforcementCount?: number;
  appliesAt?: string[];
  refuses?: boolean;
  type?: string;
  layer?: string;
  contested?: boolean;
  diverged?: boolean;
  violated?: boolean;
  vouched?: boolean;
  verified?: boolean;
}

/**
 * Normalizes memories from recall
 * and stages memories bearing on actions for pre-act gating.
 */
export function stageMemoriesFromRecall(
  memories: RawMemoryInput[],
  guardMode: "strict" | "advisory" = "strict",
): ActiveMemory[] {
  const staged: ActiveMemory[] = [];

  for (const mem of memories) {
    const memoryId = mem.id ?? mem.memoryId;
    if (!memoryId) continue;

    const title = mem.title ?? mem.text ?? "";
    const context = mem.context ?? "";
    const text = mem.title ? (context ? `${mem.title}: ${context}` : mem.title) : (mem.text ?? "");
    const tags = Array.isArray(mem.tags) ? mem.tags.map((t) => t.toLowerCase()) : [];

    // 1. Determine if this memory is a Guard vs. Directive vs. Convention vs. General Knowledge
    const isGuard =
      mem.enforce === true ||
      mem.type === "guard" ||
      tags.includes("guard") ||
      tags.includes("security") ||
      mem.refuses === true;

    const isDirective = mem.type === "directive";

    const isConvention =
      mem.type === "preference" ||
      tags.includes("convention") ||
      tags.includes("style") ||
      tags.includes("guideline");

    // 2. Determine target ActClasses (appliesAt)
    let appliesAt: ActClass[] = [];

    // Check explicit appliesAt field
    if (Array.isArray(mem.appliesAt) && mem.appliesAt.length > 0) {
      appliesAt = mem.appliesAt.filter(isActClass);
    }

    // Check tags for act classes (e.g. #change, #send, #read, #record, #answer)
    const actsFromTags = tags.filter(isActClass);
    if (actsFromTags.length > 0) {
      appliesAt = Array.from(new Set([...appliesAt, ...actsFromTags]));
    }

    // If no explicit acts declared, apply intelligent defaults based on memory category
    if (appliesAt.length === 0) {
      if (isGuard) {
        // Guard defaults to modifying / durable / external acts
        appliesAt = ["change", "record", "send"];
      } else if (isDirective || isConvention) {
        // Directives and conventions default to modifications and records
        appliesAt = ["change", "record"];
      }
    }

    // If memory doesn't bear on any acts, it's general knowledge and not staged for tool-time
    if (appliesAt.length === 0) {
      continue;
    }

    // 3. Determine refusal behavior based on guardMode:
    // A memory is a hard refusal gate ONLY if it is a Guard (type === 'guard', #guard tag, or mem.refuses === true)
    // AND guardMode is "strict".
    // In "advisory" mode, guards degrade to soft advisories (refuses: false).
    // Directives, conventions, and other memories are ALWAYS soft advisories (refuses: false).
    const refuses = isGuard && guardMode === "strict";

    staged.push({
      memoryId,
      title: mem.title ?? title,
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
  activeMemories?: ActiveMemory[];
  firedMap?: Record<string, number>;
}

export type PreActResult =
  | { verdict: "pass" }
  | {
      verdict: "refuse";
      act: ActClass;
      reason: string;
      stops: ActiveMemory[];
      pairs: { memoryId: string; act: string; tool: string; became: string }[];
    }
  | {
      verdict: "advise";
      act: ActClass;
      guidance: string;
      bears: ActiveMemory[];
      pairs: { memoryId: string; act: string; tool: string; became: string }[];
    };

/**
 * Fast in-memory Pre-Act Guard evaluator (< 1ms).
 * Decides whether to refuse, advise, or pass before a tool call.
 */
export function evaluatePreAct(options: PreActOptions): PreActResult {
  const { tool, input, guard, firedMap = {} } = options;
  const memories = options.activeMemories ?? [];

  if (!tool || !guard) {
    return { verdict: "pass" };
  }

  const act = actOf(tool, input, guard);
  if (!act) {
    return { verdict: "pass" };
  }

  const bears = memories.filter((r) => r.appliesAt.includes(act));
  if (bears.length === 0) {
    return { verdict: "pass" };
  }

  // 1. Check for hard refusals (Hard Gates)
  const stops = bears.filter((r) => r.refuses);
  if (stops.length > 0) {
    const reason = stops.map((r) => r.text || r.title).join(" · ");
    const pairs = stops.map((r) => ({
      memoryId: r.memoryId,
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
    memoryId: r.memoryId,
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
