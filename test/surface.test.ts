import { describe, expect, it } from "vitest";

import { SURFACE } from "../src/adapters/claude.js";
import { can, unsupported } from "../src/adapters/surface.js";

// A capability is answered, never absent.
//
// The shape this replaces was `Record<Moment, string>`: a moment mapped to
// one event name. A missing key meant BOTH "this harness cannot" and "we
// never wired it" — opposite facts behind the same silence. Reading the
// second as the first is how thirteen harnesses that every one of them
// documents a pre-act event came to be described as four.

describe("what an adapter says it can do", () => {
  it("answers every moment with how, or with why not", () => {
    for (const [moment, at] of Object.entries(SURFACE.moments)) {
      if (can(at)) {
        expect(at.event, `${moment} names no event`).toBeTruthy();
      } else {
        // A reason about the HARNESS. "Not built yet" is our backlog and
        // has no business being recorded as the agent's limitation.
        expect(at.unsupported, `${moment} gives no reason`).toBeTruthy();
        expect(at.unsupported).not.toMatch(/not built|todo|later|backlog|yet to/i);
      }
    }
  });

  it("names the moment an act is guarded at, and how to refuse", () => {
    const guard = SURFACE.guard;
    expect(can(guard), "claude code documents PreToolUse — this cannot be unsupported").toBe(true);
    if (!can(guard)) return;
    expect(guard.event).toBe("PreToolUse");
    expect(can(guard.refuse)).toBe(true);
    expect(can(guard.inject)).toBe(true);
  });

  it("maps its OWN tool names onto the record's five words", () => {
    // The record holds only read/change/record/send/answer and knows nothing
    // about tools, because it outlives whichever agents exist. Which tool
    // counts as sending is knowledge about one harness, and belongs here.
    const guard = SURFACE.guard;
    if (!can(guard)) throw new Error("unreachable");
    const named = Object.values(guard.tools).flat();
    expect(named.length).toBeGreaterThan(0);
    // A matcher is built from tool names, and must survive being asked for
    // an empty set — a class this agent has no tool for guards nothing.
    expect(guard.matcher?.([])).toBeUndefined();
    expect(guard.matcher?.(["Write", "Edit"])).toBe("Write|Edit");
  });
});

describe("the unsupported helper", () => {
  it("carries a reason and reads as unsupported", () => {
    const no = unsupported("this harness has no such event");
    expect(can(no)).toBe(false);
    expect(no.unsupported).toBe("this harness has no such event");
  });
});
