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
        recalls: pulse(),
        deadEnds: pulse(),
        memories: pulse(),
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
  it("reads the public door when nobody is signed in, and says whose numbers they are", async () => {
    answers({ recalls: pulse({ total: 1_412_806, today: 212_000 }) });

    expect(await stats(BASE, { allSpaces: true })).toBe(0);

    // The public reading, asked for as the public: sending a stale
    // credential here would answer with somebody's own spaces under a line
    // that says "this instance".
    expect(asked[0]).toContain("/api/v1/commons");
    expect(out()).toContain("this instance");
    expect(out()).toContain("1,412,806");
    // And the way to the other reading, since this one is not it.
    expect(out()).toContain("memcell login");
  });

  it("narrows to the space this directory is wired to", async () => {
    store.credential = { token: "mc_s" };
    wired.project = { project: { space: "payments", instance: BASE }, at: "/w/.memcell" };
    answers({ spaces: [{ slug: "payments", name: "payments" }] });

    await stats(BASE, { allSpaces: false });

    // Standing in a wired project, "how did this week go" is about THIS
    // space. Asking the unscoped door instead answers with every space the
    // account reaches, under a heading naming one of them.
    expect(asked[0]).toContain("/api/v1/stats?space=payments");
    expect(out()).toContain("payments");
  });

  it("widens past the directory when asked to", async () => {
    store.credential = { token: "mc_s" };
    wired.project = { project: { space: "payments", instance: BASE }, at: "/w/.memcell" };
    answers({
      spaces: [
        { slug: "payments", name: "payments" },
        { slug: "billing", name: "billing" },
      ],
    });

    await stats(BASE, { allSpaces: true });

    expect(asked[0]).not.toContain("space=");
    expect(out()).toContain("across 2 spaces");
  });
});

describe("how a week is drawn", () => {
  it("draws a week that did not move as a flat line, not a full bar", async () => {
    store.credential = { token: "mc_s" };
    answers({
      recalls: pulse({ total: 66, series: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
      // Scaled against zero, every bucket of an unmoving week tops out at █
      // and a dead instance draws the same shape as a busy one.
      deadEnds: pulse({ total: 48, series: Array.from({ length: 12 }, () => 4) }),
      spaces: [],
    });

    await stats(BASE, { allSpaces: true });

    expect(out()).toContain("▁▂▂▃▄▄▅▅▆▇▇█");
    expect(out()).toContain("▁▁▁▁▁▁▁▁▁▁▁▁");
  });

  it("says nothing happened today rather than pointing an arrow at zero", async () => {
    store.credential = { token: "mc_s" };
    answers({
      recalls: pulse({ total: 40, today: 0 }),
      deadEnds: pulse({ total: 4, today: 6_100 }),
      spaces: [],
    });

    await stats(BASE, { allSpaces: true });

    expect(out()).toContain("none today");
    expect(out()).not.toContain("▲ 0 today");
    // A delta keeps a digit while one still says something: rounded flat,
    // 6,100 and 6,900 both read "6k".
    expect(out()).toContain("6.1k today");
  });
});
