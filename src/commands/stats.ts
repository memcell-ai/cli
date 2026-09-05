import { call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, label, place, row, say, state, value, variant, warn } from "../ui.js";

// What the agents did.
//
// Three verbs, and they are about the agent rather than about memcell:
// rules it followed, acts memory stopped, and rules it went against having
// already gone against them once.
//
// Signed in it counts your space; signed out it counts the instance, which
// is the same reading the landing page shows a stranger — so somebody who
// has not signed up yet can run this and check the numbers on the page
// against the instance that served them.
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
  /** Which reading this is, said by the door rather than inferred from
   *  which fields came back. */
  scope: { kind: "instance" | "space"; space: { slug: string; name: string } | null };
  /** Absent on the public reading — nobody's spaces were counted. */
  spaces?: { slug: string; name: string }[];
  followed: Pulse;
  stopped: Pulse;
  repeated: Pulse;
  /** How many firings were LOOKED at. `followed` cannot be read without it:
   *  zero against nothing judged is the loop not running, zero against
   *  everything judged is the loop running on material that showed neither. */
  judged: Pulse;
  /** What the three came to, in tokens, and the three it is made of. */
  saved: Pulse & { from: { stopped: number; followed: number; repeated: number } };
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

/** `says` is given singular and plural: "1 memory" read as "1 memories" on
 *  a fresh instance, which is the first line a new person sees. */
const figure = (name: string, pulse: Pulse, says: (n: number) => string) =>
  row(
    1,
    [label(name)],
    [value(pulse.total.toLocaleString("en-US")), label(says(pulse.total))],
    [variant(spark(pulse.series))],
    // "▲ 0 today" is an arrow claiming a rise that did not happen.
    pulse.today > 0 ? [state("good", `${brief(pulse.today)} today`, "▲")] : [label("none today")],
  );

/** What the figure is made of, largest first and with the empty ones left
 *  out. A term at nothing still reads as a term, and it goes in front of the
 *  one carrying the number as often as not. */
function madeOf(from: { stopped: number; followed: number; repeated: number }): string {
  const parts = [
    { n: from.followed, says: "followed" },
    { n: from.stopped, says: "stopped" },
  ]
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((p) => `+${p.n.toLocaleString("en-US")} ${p.says}`);
  if (from.repeated > 0) parts.push(`−${from.repeated.toLocaleString("en-US")} repeated`);
  return parts.join(" · ");
}

export async function stats(instance: string): Promise<number> {
  const signedIn = Boolean(await credentialFor(instance));
  // Standing in a linked project, the question is about THIS space. The
  // door's own default is the space you were last working in, so an
  // unlinked directory still gets one space rather than a sum across all
  // of them — `--all-spaces` widened it and was a third way to spell a
  // question that already had two.
  const here = signedIn ? await findProject() : null;

  try {
    const read = await call<Stats>(
      instance,
      here ? `/api/v1/stats?space=${encodeURIComponent(here.project.space)}` : "/api/v1/stats",
      signedIn ? {} : { anonymous: true },
    );

    const named = read.scope.space?.slug;
    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [label(`${read.window.days}d`)],
        read.scope.kind === "space" && named
          ? [label("space"), value(named)]
          : [label("this instance")],
      ),
      figure("followed", read.followed, () => "rules kept at the moment they applied"),
      figure("stopped", read.stopped, (n) => `act${n === 1 ? "" : "s"} memory prevented`),
      figure("repeated", read.repeated, (n) => `correction${n === 1 ? "" : "s"} that did not take`),
      // Not a fourth verb — the denominator the first one is read against.
      // Without it, "followed 0" says nothing: it is the same number for an
      // agent that ignored everything and an instance that judged nothing.
      row(
        1,
        [label("judged")],
        [value(read.judged.total.toLocaleString("en-US")), label("of these were looked at")],
        read.judged.total === 0
          ? [state("warn", "nothing judged — followed cannot be read", "!")]
          : [],
      ),
      row(
        1,
        [label("saved")],
        // The same words the page uses. One thing said two ways is two
        // things as far as anybody reading both is concerned.
        [value(read.saved.total.toLocaleString("en-US")), label("tokens saved")],
        [label(madeOf(read.saved.from))],
      ),
      !signedIn && row(2, [label("your own")], [label("sign in with"), cmd("memcell login")]),
      signedIn &&
        !named &&
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
