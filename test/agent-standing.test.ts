import { afterEach, describe, expect, it, vi } from "vitest";

import { agentStanding } from "../src/client.js";

// The credential the HOOKS carry, which is not the one `memcell status` was
// checking.
//
// `whoami` answers for the person's session — good for a week, and live the
// whole time every hook on the machine is being turned away. The two fail
// independently, and the way this goes wrong is silent: a refused hook
// writes a line to a log nobody reads and carries on. Reporting the session
// as the answer meant the one command a person runs when something feels
// wrong confidently said everything was fine.

const BASE = "http://instance.test";

afterEach(() => vi.unstubAllGlobals());

function answers(status: number, body: unknown) {
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    sent = (init?.headers as Record<string, string>) ?? {};
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}
let sent: Record<string, string> = {};

describe("asking a key about itself", () => {
  it("presents the AGENT key, not the person's session", async () => {
    // The whole point: this call must carry the credential under test.
    answers(200, {
      agent: "claude code",
      space: "payments",
      standing: "ok",
      calls: { used: 12, ceiling: 5000, resetsAt: "2026-08-25T00:00:00.000Z" },
      says: null,
    });
    const said = await agentStanding(BASE, "mc_the-agent-key");
    expect(sent.authorization).toBe("Bearer mc_the-agent-key");
    expect(said.standing).toBe("ok");
    expect(said.agent).toBe("claude code");
  });

  it("carries what a person should do when the key has stopped working", async () => {
    answers(200, {
      agent: "claude code",
      space: "payments",
      standing: "over_ceiling",
      calls: { used: 5000, ceiling: 5000, resetsAt: "2026-08-25T00:00:00.000Z" },
      says: "This key has made 5,000 calls today, over its ceiling of 5,000.",
    });
    const said = await agentStanding(BASE, "mc_the-agent-key");
    expect(said.standing).toBe("over_ceiling");
    expect(said.says).toContain("ceiling");
  });

  it("turns a refused key into a sentence rather than a throw with no words", async () => {
    // A revoked key answers 401 at the door. That is the failure this whole
    // path exists to surface, so it must arrive as something printable.
    answers(401, { error: "unauthenticated", message: "That key is not valid." });
    const error = await agentStanding(BASE, "mc_dead").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.length).toBeGreaterThan(0);
  });
});

describe("what status actually verifies", () => {
  it("checks the hooks' key, not only the person's session", async () => {
    // The defect this closes is one command answering a different question
    // than the one being asked. Pinned at the call site, because a status
    // that quietly goes back to reporting only `whoami` looks identical to
    // one that works — right up until somebody's usage silently stops.
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await readFile(
      path.resolve(__dirname, "..", "src", "commands", "status.ts"),
      "utf8",
    );
    expect(source).toContain("agentStanding");
    expect(source).toContain("agentKeyForProject");
    // The helper existing is not the same as status calling it — a dead
    // function reads exactly like a live one from the outside.
    expect(source).toMatch(/await hookKey\(/);
    // And it must say something when there is no key at all — a linked
    // project with no agent key is wired to nothing.
    expect(source).toContain("no agent key");
  });
});
