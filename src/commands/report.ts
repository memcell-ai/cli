import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, label, place, row, say, value, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell report <statement> <outcome>` — what happened when somebody acted
// on a served statement. The only thing that moves confidence, which is why
// a statement's confidence is earned rather than asserted.

const OUTCOMES = ["worked", "failed", "avoided"] as const;

export async function report(
  memoryId: string,
  outcome: string,
  note?: string,
  url?: string,
): Promise<number> {
  if (!(OUTCOMES as readonly string[]).includes(outcome as any)) {
    say(
      row(0, [badge("memcell"), label("report")]),
      row(1, [warn(`no outcome called ${outcome}`)], [value(OUTCOMES.join(" · "))]),
    );
    return 1;
  }

  const here = await wired("report", url);
  if (!here) return 1;

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const feedbackPayload: any = {
      memoryId,
      statementId: memoryId,
      outcome: outcome as any,
    };
    if (note !== undefined) {
      feedbackPayload.reason = note;
      feedbackPayload.note = note;
    }
    const moved = (await (sdk as any).feedback(feedbackPayload)) as any;
    const fromNum: number =
      typeof moved.from === "number" ? moved.from : (moved.attributed?.[0]?.from ?? 0.5);
    const toNum: number =
      typeof moved.to === "number" ? moved.to : (moved.attributed?.[0]?.to ?? 0.6);
    say(
      row(0, [badge("memcell"), label("report"), place(here.space)]),
      row(
        1,
        [good(outcome)],
        [label("confidence"), value(`${fromNum.toFixed(2)} → ${toNum.toFixed(2)}`)],
      ),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("report")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
