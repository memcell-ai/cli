import { call, MemcellError } from "../client.js";
import { badge, bad, good, label, place, row, say, value, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell report <statement> <outcome>` — what happened when somebody acted
// on a served statement. The only thing that moves confidence, which is why
// a statement's standing is earned rather than asserted.

const OUTCOMES = ["worked", "failed", "avoided"] as const;

export async function report(
  statementId: string,
  outcome: string,
  note?: string,
  url?: string,
): Promise<number> {
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    say(
      row(0, [badge("memcell"), label("report")]),
      row(1, [warn(`no outcome called ${outcome}`)], [value(OUTCOMES.join(" · "))]),
    );
    return 1;
  }

  const here = await wired("report", url);
  if (!here) return 1;

  try {
    const moved = await call<{ from: number; to: number }>(
      here.instance,
      `/api/v1/spaces/${encodeURIComponent(here.space)}/statements/${encodeURIComponent(statementId)}/outcomes`,
      { method: "POST", bearer: here.key, body: { outcome, ...(note ? { note } : {}) } },
    );
    say(
      row(0, [badge("memcell"), label("report"), place(here.space)]),
      row(
        1,
        [good(outcome)],
        [label("confidence"), value(`${moved.from.toFixed(2)} → ${moved.to.toFixed(2)}`)],
      ),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("report")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
