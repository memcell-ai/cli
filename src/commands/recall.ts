import { call, MemcellError } from "../client.js";
import { badge, bad, id, label, place, row, say, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell recall <intent>` — what memory serves before acting, from a
// shell. The same door the hooks and the MCP tool call, so an agent with no
// MCP support reaches the identical answer.

interface Served {
  statementId: string;
  text: string;
  kind: string | null;
  confidence: number;
  layer: string;
  vouched: boolean;
  /** Here because the space pins it, not because it matched. Marked, so
   *  presence is never read as an answer to what was asked. */
  pinned?: boolean;
}

export async function recall(intent: string, limit?: string, url?: string): Promise<number> {
  const here = await wired("recall", url);
  if (!here) return 1;

  const asked = Number(limit);
  try {
    const answer = await call<{ momentId: string; results: Served[] }>(
      here.instance,
      "/api/v1/recall",
      {
        method: "POST",
        bearer: here.key,
        body: { intent, ...(Number.isFinite(asked) && asked > 0 ? { limit: asked } : {}) },
      },
    );

    if (answer.results.length === 0) {
      // An empty answer is an answer: memory does not guess.
      say(
        row(0, [badge("memcell"), label("recall"), place(here.space)]),
        row(1, [label("nothing established here yet")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("recall"), place(here.space)],
        [variant(`${answer.results.length}`)],
      ),
      ...answer.results.flatMap((s) => [
        row(
          1,
          [value(s.confidence.toFixed(2))],
          s.kind ? [variant(s.kind)] : null,
          s.pinned ? [variant("pinned")] : null,
          !s.vouched ? [variant("unvouched")] : null,
          [label(s.text)],
        ),
        // The id, because reporting an outcome on this needs it.
        row(2, [id(s.statementId)]),
      ]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("recall")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
