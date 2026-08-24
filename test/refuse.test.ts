import { describe, expect, it } from "vitest";

import { adapterFor, allAdapters } from "../src/adapters/index.js";

// The one place the loop is allowed to stand in the way.
//
// Everything else about this hook fails open, deliberately: a hook that
// blocks work it should not is a hook that gets removed, and a removed hook
// remembers nothing at all. Refusing happens only where a person turned it
// on for one rule, and it always carries that rule's own words — nobody is
// stopped without being told what stopped them.

describe("refusing an act", () => {
  it("says it in Claude Code's own decision, not an exit code", () => {
    const spoken = adapterFor("claude")!.refuse!("Never push straight to main.");
    const parsed = JSON.parse(spoken!) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    // Verified against the shipped binary: allow · deny · ask · defer.
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    // The reason is the rule, verbatim — a wall with no sign on it is worse
    // than no wall, because nobody learns anything from it.
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("Never push straight to main.");
  });

  it("carries the rule's words wherever an adapter speaks one", () => {
    // An adapter without its own dialect is not a gap: the command falls
    // back to exit 2 with the reason on stderr, which every harness
    // surveyed reads as "do not run this, and tell the model why".
    for (const adapter of allAdapters()) {
      const spoken = adapter.refuse?.("the rule that stopped it");
      if (!spoken) continue;
      expect(spoken, `${adapter.name} refused without saying why`).toContain(
        "the rule that stopped it",
      );
    }
  });
});
