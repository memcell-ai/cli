import { describe, expect, it } from "vitest";

import { actOf } from "../src/loop/act.js";
import { SURFACE } from "../src/adapters/claude.js";
import { can } from "../src/adapters/surface.js";

// Which moment an act belongs to, decided from the act.
//
// The record holds five words every trade shares and knows nothing about
// tools. Turning "the Bash tool running `git push`" into one of those five is
// knowledge about one harness and one shell, and it lives here.
//
// Silence is a real answer and the common one. A rule shown where it does not
// apply is worse than no rule: the next one gets skipped too.

const guard = (() => {
  if (!can(SURFACE.guard)) throw new Error("claude code documents PreToolUse");
  return SURFACE.guard;
})();

const bash = (command: string) => actOf("Bash", { command }, guard);

describe("naming the act", () => {
  it("reads a tool that can only be one thing off its name", () => {
    expect(actOf("Read", {}, guard)).toBe("read");
    expect(actOf("Grep", {}, guard)).toBe("read");
    expect(actOf("Write", {}, guard)).toBe("change");
    expect(actOf("Edit", {}, guard)).toBe("change");
  });

  it("asks the COMMAND when the tool is every act at once", () => {
    // One shell runs all of them, so its name cannot say which.
    expect(bash("git push origin main")).toBe("send");
    expect(bash("gh pr create --title x")).toBe("send");
    expect(bash("npm publish")).toBe("send");
    expect(bash("git commit -m 'x'")).toBe("record");
    expect(bash("git checkout -b fix/retries")).toBe("record");
    expect(bash("git status")).toBe("read");
  });

  it("is not fooled by a prefix", () => {
    // `git push` must not be read as `git`, nor `git commit` as a send.
    expect(bash("git commit -m 'push it'")).toBe("record");
    expect(bash("git log --oneline")).toBe("read");
  });

  it("says nothing rather than guessing", () => {
    // Each of these is an act this build has no honest opinion about.
    expect(bash("make build")).toBeNull();
    expect(bash("")).toBeNull();
    expect(actOf("Bash", undefined, guard)).toBeNull();
    // A tool the adapter never named is not guarded at all.
    expect(actOf("SomeToolNobodyDeclared", {}, guard)).toBeNull();
  });
});

describe("what the record is allowed to know", () => {
  it("never learns a tool name", () => {
    // The five words outlive whichever agents exist. A tool name reaching
    // the record is a coding assumption in the one layer that must stay
    // general — the whole reason this mapping lives in the adapter.
    const classes = Object.keys(guard.tools);
    for (const word of classes) {
      expect(word).toMatch(/^(read|change|record|send|answer)$/);
    }
  });
});
