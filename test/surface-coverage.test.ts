import { describe, expect, it } from "vitest";

import { allAdapters } from "../src/adapters/index.js";
import { can, type ActClass } from "../src/adapters/surface.js";

// Every agent declares what it can do, and the declaration is real.
//
// A surface that exists but names no tools guards nothing — the same silence
// as having no surface at all, wearing the look of coverage. So the shape is
// asserted, not its presence.

const adapters = allAdapters();

describe("what every adapter declares", () => {
  it.each(adapters.map((a) => a.name))("%s carries a surface", (name) => {
    const adapter = adapters.find((a) => a.name === name)!;
    expect(
      adapter.surface,
      `${name} declares nothing — a reader cannot tell whether its harness cannot, or whether we did not`,
    ).toBeTruthy();
  });

  it.each(adapters.map((a) => a.name))("%s names the tools it guards", (name) => {
    const surface = adapters.find((a) => a.name === name)!.surface!;
    const guard = surface.guard;
    expect(can(guard), `${name} has no guard`).toBe(true);
    if (!can(guard)) return;

    // A guard that names no tool fires and says nothing, forever.
    const named = Object.values(guard.tools).flat();
    expect(named.length, `${name} guards no tool`).toBeGreaterThan(0);

    // The two that matter most: something must count as changing, and
    // something as sending. Those are where the standing rules live.
    expect(guard.tools.change?.length ?? 0, `${name} names nothing as change`).toBeGreaterThan(0);
    expect(guard.tools.send?.length ?? 0, `${name} names nothing as send`).toBeGreaterThan(0);
  });

  it.each(adapters.map((a) => a.name))("%s answers every moment", (name) => {
    const surface = adapters.find((a) => a.name === name)!.surface!;
    for (const [moment, at] of Object.entries(surface.moments)) {
      if (can(at)) expect(at.event, `${name}/${moment} names no event`).toBeTruthy();
      else expect(at.unsupported).not.toMatch(/not built|todo|later|backlog|yet to/i);
    }
  });
});

describe("what the record never learns", () => {
  it("keeps tool names out of the five words", () => {
    // The record holds read/change/record/send/answer and nothing else,
    // because it outlives whichever agents exist. Every tool name lives in
    // an adapter — this asserts the boundary rather than trusting it.
    const WORDS: ActClass[] = ["read", "change", "record", "send", "answer"];
    for (const adapter of adapters) {
      const guard = adapter.surface?.guard;
      if (!guard || !can(guard)) continue;
      for (const key of Object.keys(guard.tools)) {
        expect(WORDS, `${adapter.name} invented the class "${key}"`).toContain(key as ActClass);
      }
    }
  });
});
