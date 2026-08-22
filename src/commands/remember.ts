import { call, MemcellError } from "../client.js";
import { badge, bad, good, id, label, place, row, say, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell remember <text>` — file one finished statement from a shell.
//
// One claim, already distilled: this door does no distilling, so a wall of
// prose lands as a wall. Hand documents to `memcell ingest` instead, which
// exists to break them into claims.

interface Written {
  id: string;
  scope: string;
  confidence: number;
  note: string;
}

export async function remember(text: string, kind?: string): Promise<number> {
  const here = await wired("remember");
  if (!here) return 1;

  try {
    const written = await call<Written>(
      here.instance,
      `/api/v1/spaces/${encodeURIComponent(here.space)}/statements`,
      { method: "POST", bearer: here.key, body: { text, ...(kind ? { kind } : {}) } },
    );
    say(
      row(0, [badge("memcell"), label("remember"), place(here.space)]),
      row(
        1,
        [good(written.note)],
        [label("confidence"), value(written.confidence.toFixed(2))],
        [variant(written.scope)],
      ),
      row(2, [id(written.id)]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("remember")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
