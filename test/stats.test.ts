import { beforeEach, describe, expect, it, vi } from "vitest";

// `memcell stats`, and the one thing about it that can quietly mislead.
//
// The figures signed in and the figures signed out have the same three
// labels and the same shape. Only the scope differs, and a reader cannot
// tell them apart by looking — so the reading has to say which one it is,
// and the request has to actually ASK for the scope it claims.

const said: string[] = [];
vi.spyOn(console, "log").mockImplementation((line: unknown) => said.push(String(line)));

const store = { credential: null as { token: string } | null };
const wired = {
  project: null as { project: { space: string; instance: string }; at: string } | null,
};

vi.mock("../src/instance.js", async (original) => ({
  ...(await original<typeof import("../src/instance.js")>()),
  credentialFor: async () => store.credential,
}));
vi.mock("../src/project.js", async (original) => ({
  ...(await original<typeof import("../src/project.js")>()),
  findProject: async () => wired.project,
}));

const { stats } = await import("../src/commands/stats.js");

const BASE = "http://instance.test";
const out = () => said.join("\n");

let asked: string[] = [];

const pulse = (over: Partial<{ total: number; today: number; series: number[] }> = {}) => ({
  total: 0,
  today: 0,
  series: Array.from({ length: 12 }, () => 0),
  ...over,
});

function answers(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(String(url));
    return new Response(
      JSON.stringify({
        window: { days: 7, buckets: 12, since: "2026-08-19T00:00:00.000Z" },
        scope: { kind: "instance", space: null },
        followed: pulse(),
        stopped: pulse(),
        repeated: pulse(),
        judged: pulse({ total: 1 }),
        saved: { ...pulse(), from: { stopped: 0, followed: 0, repeated: 0 } },
        ...body,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

beforeEach(() => {
  said.length = 0;
  asked = [];
  store.credential = null;
  wired.project = null;
});

describe("which numbers you were shown", () => {
  it("reads the one door as the public when nobody is signed in", async () => {
    answers({ followed: pulse({ total: 1_412_806, today: 212_000 }) });

    expect(await stats(BASE)).toBe(0);

    // One door for both readings, and the public one asked for AS the
    // public: sending a stale credential here would answer with somebody's
    // own space under a line that says "this instance".
    expect(asked[0]).toContain("/api/v1/stats");
    expect(asked[0]).not.toContain("space=");
    expect(out()).toContain("this instance");
    expect(out()).toContain("1,412,806");
    // And the way to the other reading, since this one is not it.
    expect(out()).toContain("memcell login");
  });

  it("narrows to the space this directory is wired to", async () => {
    store.credential = { token: "mc_s" };
    wired.project = { project: { space: "payments", instance: BASE }, at: "/w/.memcell" };
    answers({ scope: { kind: "space", space: { slug: "payments", name: "payments" } } });

    await stats(BASE);

    // Standing in a wired project, "how did this week go" is about THIS
    // space, and the door is asked for it by name.
    expect(asked[0]).toContain("/api/v1/stats?space=payments");
    expect(out()).toContain("payments");
  });

  it("takes the scope from the door rather than inferring it", async () => {
    // Signed in with no linked directory. The door answers about the space
    // the person was last working in and says so; the CLI must print what
    // it was told rather than guessing from which fields came back.
    store.credential = { token: "mc_s" };
    answers({ scope: { kind: "space", space: { slug: "billing", name: "billing" } } });

    await stats(BASE);

    expect(asked[0]).not.toContain("space=");
    expect(out()).toContain("billing");
    expect(out()).not.toContain("this instance");
  });
});

describe("the number that makes the first one readable", () => {
  it("says how many firings were judged, beside the ones that were followed", async () => {
    store.credential = { token: "mc_s" };
    answers({ followed: pulse({ total: 0 }), judged: pulse({ total: 24 }) });

    await stats(BASE);

    expect(out()).toContain("24");
    expect(out()).toContain("looked at");
  });

  it("warns when nothing was judged, because followed then says nothing", async () => {
    // Zero followed against zero judged is the loop not running. Zero
    // followed against everything judged is the loop running on material
    // that showed neither. Same headline, opposite readings — so the one
    // that means the product is broken has to say so.
    store.credential = { token: "mc_s" };
    answers({ followed: pulse({ total: 0 }), judged: pulse({ total: 0 }) });

    await stats(BASE);

    expect(out()).toContain("nothing judged");
  });
});

describe("what was not spent", () => {
  it("prints the figure and the three it is made of", async () => {
    // A single number nobody can take apart is a number nobody can check,
    // and this one is a model rather than a meter.
    store.credential = { token: "mc_s" };
    answers({
      saved: {
        ...pulse({ total: 9_000 }),
        from: { stopped: 4_000, followed: 6_000, repeated: 1_000 },
      },
    });

    await stats(BASE);

    expect(out()).toContain("9,000");
    // The same words the page uses. One thing said two ways is two things to
    // anybody reading both.
    expect(out()).toContain("tokens saved");
    expect(out()).toContain("+6,000 followed");
    expect(out()).toContain("+4,000 stopped");
    expect(out()).toContain("−1,000 repeated");
    // Largest first: the part doing the work goes in front of the one that
    // is not.
    expect(out().indexOf("6,000")).toBeLessThan(out().indexOf("4,000"));
  });

  it("leaves out a part that came to nothing rather than printing a zero", async () => {
    store.credential = { token: "mc_s" };
    answers({
      saved: { ...pulse({ total: 6_000 }), from: { stopped: 0, followed: 6_000, repeated: 0 } },
    });

    await stats(BASE);

    // The verbs name rows of their own above, so the assertion is about the
    // line this figure is on rather than the whole reading.
    const line = out()
      .split("\n")
      .find((l) => l.includes("tokens saved"))!;
    expect(line).not.toContain("stopped");
    expect(line).toContain("+6,000 followed");
  });

  it("says nothing about corrections when none were subtracted", async () => {
    store.credential = { token: "mc_s" };
    answers({
      saved: { ...pulse({ total: 9_000 }), from: { stopped: 4_000, followed: 5_000, repeated: 0 } },
    });

    await stats(BASE);

    // The minus only ever prefixes the subtracted term on this line.
    expect(out()).not.toContain("−");
  });
});

describe("how a week is drawn", () => {
  it("draws a week that did not move as a flat line, not a full bar", async () => {
    store.credential = { token: "mc_s" };
    answers({
      followed: pulse({ total: 66, series: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
      // Scaled against zero, every bucket of an unmoving week tops out at █
      // and a dead instance draws the same shape as a busy one.
      stopped: pulse({ total: 48, series: Array.from({ length: 12 }, () => 4) }),
    });

    await stats(BASE);

    expect(out()).toContain("▁▂▂▃▄▄▅▅▆▇▇█");
    expect(out()).toContain("▁▁▁▁▁▁▁▁▁▁▁▁");
  });

  it("says nothing happened today rather than pointing an arrow at zero", async () => {
    store.credential = { token: "mc_s" };
    answers({
      followed: pulse({ total: 40, today: 0 }),
      stopped: pulse({ total: 4, today: 6_100 }),
    });

    await stats(BASE);

    expect(out()).toContain("none today");
    expect(out()).not.toContain("▲ 0 today");
    // A delta keeps a digit while one still says something: rounded flat,
    // 6,100 and 6,900 both read "6k".
    expect(out()).toContain("6.1k today");
  });
});
