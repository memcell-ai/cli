import { call, MemcellError, stream } from "../client.js";
import { credentialFor } from "../instance.js";
import {
  badge,
  bad,
  clearLine,
  cmd,
  duration,
  good,
  label,
  meter,
  pending,
  percent,
  place,
  repaint,
  row,
  say,
  state,
  time,
  value,
  variant,
  warn,
  text,
  type Row,
} from "../ui.js";

// `memcell seed <source>` — one command whose meaning depends on who runs
// it. An operator seeds the commons and watches the crawl; anyone else
// files a proposal. Neither has to know which they are beforehand.

interface SeedResult {
  /** `watching` = the memory already exists and this is a window onto it. */
  outcome: "seeded" | "watching" | "proposed" | "already_proposed";
  slug?: string;
  source?: string;
}

/** The run shape the instance streams — the same reading the console draws. */
interface Run {
  phase: string;
  pulling: boolean;
  done: boolean;
  items: number;
  queued: number;
  settled: number;
  statements: number;
  held: number;
  failing: number;
  error: string | null;
  elapsedMs: number;
  etaMs: number | null;
  fraction: number | null;
}

interface Progress {
  slug: string;
  pipeline: string | null;
  run: Run | null;
}

const PHASE_WORD: Record<string, string> = {
  queued: "queued",
  cloning: "cloning",
  paging: "paging",
  distilling: "distilling",
  done: "live",
  failed: "failed",
  interrupted: "interrupted",
};

/** The status line itself: badge, meter, reading, elapsed. One row that
 *  changes in place — the shape a terminal reports live work in. */
function statusLine(slug: string, run: Run, tick: number): Row {
  const word = PHASE_WORD[run.phase] ?? run.phase;

  // Pulling has no denominator yet, so the meter moves rather than fills.
  const gauge = run.pulling
    ? [text(pending(14, tick)), value(`${run.items.toLocaleString()} pulled`)]
    : [
        meter(
          run.settled,
          run.queued,
          run.fraction === null
            ? `${run.items.toLocaleString()} pulled`
            : `${percent(run.fraction)} ${run.settled.toLocaleString()}/${run.queued.toLocaleString()}`,
        ),
      ];

  return row(
    0,
    [badge(slug)],
    gauge,
    [label("learned"), state("good", run.statements.toLocaleString(), "")],
    [variant(word)],
    [time(duration(run.elapsedMs) + (run.etaMs !== null ? ` · ${duration(run.etaMs)} left` : ""))],
  );
}

export async function seed(
  instance: string,
  source: string | undefined,
  options: { reason?: string; watch: boolean },
): Promise<number> {
  if (!source) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("no source")], [label("try"), cmd("memcell memories seed facebook/react")]),
    );
    return 1;
  }

  if (!(await credentialFor(instance))) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("no session")], [label("run"), cmd("memcell login"), label("first")]),
    );
    return 1;
  }

  let result: SeedResult;
  try {
    result = await call<SeedResult>(instance, "/api/v1/commons/seed", {
      method: "POST",
      body: { source, reason: options.reason },
    });
  } catch (error) {
    const failure = error as MemcellError;
    say(
      row(0, [badge("memcell"), place(instance)], [variant(source)]),
      row(1, [bad("refused")], [label(failure.message)]),
    );
    return 1;
  }

  if (result.outcome !== "seeded" && result.outcome !== "watching") {
    const already = result.outcome === "already_proposed";
    say(
      row(0, [badge("memcell"), place(instance)], [variant(result.source ?? source)]),
      row(
        1,
        [already ? warn("already proposed") : good("proposed")],
        [label(already ? "an operator has not decided yet" : "an operator will decide")],
      ),
      row(2, [label("not your instance · the ask was recorded")]),
    );
    return 0;
  }

  const slug = result.slug!;
  const started = result.outcome === "seeded";
  say(
    row(0, [badge("memcell"), place(instance)], [variant(slug)]),
    started
      ? row(1, [state("good", "seeding", "✦")], [label("the crawl is queued")])
      : row(1, [state("good", "watching", "✦")], [label("this memory is already in the commons")]),
    started && row(2, [label("watch it any time with"), cmd(`memcell memories seed ${slug}`)]),
  );

  if (!options.watch) return 0;

  // The crawl runs on the instance's worker, so this is a WINDOW onto it
  // rather than the work itself — Ctrl-C leaves the seed running. The
  // instance pushes; this terminal never asks twice.
  let last: Run | null = null;
  let tick = 0;
  const spin = setInterval(() => {
    // Keeps the indeterminate meter moving between pushes, so "pulling" is
    // visibly alive even when the numbers have not changed for a few seconds.
    if (last?.pulling) repaint(statusLine(slug, last, ++tick));
  }, 400);

  try {
    for await (const frame of stream(
      instance,
      `/api/v1/commons/seed?live=1&slug=${encodeURIComponent(slug)}`,
    )) {
      if (frame.event === "idle") break;
      if (frame.event !== "state") continue;
      const progress = JSON.parse(frame.data) as Progress;
      if (!progress.run) continue;
      last = progress.run;
      repaint(statusLine(slug, last, tick));
      if (last.done) break;
    }
  } catch (error) {
    clearLine();
    say(
      row(0, [badge(slug), place(instance)]),
      row(1, [state("warn", "lost the stream", "◇")], [label((error as Error).message)]),
      row(2, [
        label("the crawl keeps going — reattach with"),
        cmd(`memcell memories seed ${slug}`),
      ]),
    );
    return 0;
  } finally {
    clearInterval(spin);
  }

  clearLine();
  if (!last) {
    say(
      row(0, [badge(slug), place(instance)]),
      row(
        1,
        [state("warn", "still crawling", "◇")],
        [label("it keeps going without this terminal")],
      ),
    );
    return 0;
  }

  const failed = last.phase === "failed" || last.error !== null;
  say(
    row(0, [badge(slug), place(instance)], [variant(PHASE_WORD[last.phase] ?? last.phase)]),
    failed
      ? row(1, [bad("stalled")], [label(last.error ?? "the crawl did not finish")])
      : row(
          1,
          [good("live")],
          [label("learned"), state("good", last.statements.toLocaleString(), "")],
          [label("from"), value(last.settled.toLocaleString()), label("items")],
          [time(`in ${duration(last.elapsedMs)}`)],
        ),
    last.held > 0 &&
      row(
        2,
        [label(`${last.held.toLocaleString()} item(s) still held`)],
        last.failing > 0 ? [label(`${last.failing} with a cause`)] : null,
      ),
    row(2, [label("read it at"), place(`${instance}/m/${slug}`)]),
  );
  return failed ? 1 : 0;
}
