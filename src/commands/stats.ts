import { call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, label, place, row, say, state, value, variant, warn } from "../ui.js";

// What the last seven days did.
//
// Signed in it counts what you reach; signed out it counts the instance,
// which is the same reading the landing page shows a stranger — so somebody
// who has not signed up yet can still run this and check the numbers on the
// page against the instance that served it.
//
// Which of the two you got is said out loud. The figures look alike, and
// inferring the scope from the size of them is how "my agents did nothing
// this week" turns out to have been the whole instance all along.

const MARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

interface Pulse {
  total: number;
  today: number;
  series: number[];
}

interface Stats {
  window: { days: number; buckets: number; since: string };
  /** Absent on the public reading — nobody's spaces were counted. */
  spaces?: { slug: string; name: string }[];
  recalls: Pulse;
  deadEnds: Pulse;
  memories: Pulse;
}

/** Scaled across the series' own range rather than against zero: a week that
 *  did not move draws a flat line instead of a full bar, and a running total
 *  reads as a climb. The number beside it is the value; this is the shape. */
function spark(series: number[]): string {
  const top = Math.max(...series);
  const floor = Math.min(...series);
  const span = top - floor;
  return series
    .map((n) => MARKS[span === 0 ? 0 : Math.round(((n - floor) / span) * (MARKS.length - 1))]!)
    .join("");
}

/** The delta is read at a glance, so it abbreviates where the figure beside
 *  it does not — and keeps a digit while one still says something. */
function brief(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}

const figure = (flag: string, pulse: Pulse, says: string) =>
  row(
    1,
    [label(flag)],
    [value(pulse.total.toLocaleString("en-US")), label(says)],
    [variant(spark(pulse.series))],
    // "▲ 0 today" is an arrow claiming a rise that did not happen.
    pulse.today > 0 ? [state("good", `${brief(pulse.today)} today`, "▲")] : [label("none today")],
  );

export async function stats(instance: string, opts: { allSpaces: boolean }): Promise<number> {
  const signedIn = Boolean(await credentialFor(instance));
  // Where the directory points wins: standing in a linked project, the
  // question is about THIS space unless the flag widens it.
  const here = signedIn && !opts.allSpaces ? await findProject() : null;

  try {
    const read = signedIn
      ? await call<Stats>(
          instance,
          here ? `/api/v1/stats?space=${encodeURIComponent(here.project.space)}` : "/api/v1/stats",
        )
      : await call<Stats>(instance, "/api/v1/commons", { anonymous: true });

    const counted = read.spaces?.length ?? 0;
    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [label(`${read.window.days}d`)],
        signedIn
          ? here
            ? [label("space"), value(here.project.space)]
            : [label(`across ${counted} space${counted === 1 ? "" : "s"}`)]
          : [label("this instance")],
      ),
      figure("--recalls", read.recalls, "served into live sessions"),
      figure("--dead-ends", read.deadEnds, "mistakes not repeated"),
      figure("--commons", read.memories, "memories free on day one"),
      !signedIn && row(2, [label("your own")], [label("sign in with"), cmd("memcell login")]),
      signedIn &&
        counted === 0 &&
        !here &&
        row(2, [label("no spaces yet")], [label("wire one with"), cmd("memcell connect")]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError && error.status === 404) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [warn("no such space here")], [label("list them with"), cmd("memcell spaces")]),
      );
      return 1;
    }
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn(error instanceof Error ? error.message : "could not read the instance")]),
    );
    return 1;
  }
}
