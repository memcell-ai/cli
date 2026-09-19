import { call, MemcellError } from "../client.js";
import { badge, bad, good, id, label, place, row, say, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell remember <text>` — file one finished statement from a shell.
// Hand whole documents or files to `memcell import` instead.

interface Written {
  id: string;
  scope: string;
  confidence: number;
  note: string;
}

/** The five moments a directive can bear on — the record's own words, so a person
 *  filing one by hand can say WHEN it applies and have it served then. */
const APPLIES_AT = ["read", "change", "record", "send", "answer"] as const;

export async function remember(
  text: string,
  typeOrKind?: string,
  at?: string,
  url?: string,
): Promise<number> {
  // Refused by name rather than dropped: a directive filed as applying at a
  // moment nothing fires would sit here looking wired and never be served.
  const appliesAt = (at ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  const unknown = appliesAt.filter((word) => !(APPLIES_AT as readonly string[]).includes(word));
  if (unknown.length > 0) {
    say(
      row(0, [badge("memcell"), label("remember")]),
      row(1, [bad("no such moment")], [label(unknown.join(", "))]),
      row(2, [label("try")], [value(APPLIES_AT.join(", "))]),
    );
    return 1;
  }
  return file(text, typeOrKind, appliesAt, url);
}

async function file(
  text: string,
  typeOrKind?: string,
  appliesAt: string[] = [],
  url?: string,
): Promise<number> {
  const here = await wired("remember", url);
  if (!here) return 1;

  try {
    const written = await call<Written>(here.instance, "/api/v1/remember", {
      method: "POST",
      bearer: here.key,
      body: {
        text,
        ...(typeOrKind ? { type: typeOrKind, kind: typeOrKind } : {}),
        ...(appliesAt.length > 0 ? { applies_at: appliesAt } : {}),
      },
    });
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
