import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { call, MemcellError } from "../client.js";
import { badge, bad, good, label, place, row, say, value, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell ingest <file>` — hand a document to this directory's memory and
// let it do its own distilling. The connection IS the credential: a wired
// directory holds a pair key that already names the instance and the space,
// so this asks for no login — the same standing the hooks act on every turn.

interface Kept {
  created: { statementId: string }[];
  reinforced: { statementId: string }[];
  note?: string;
}

export async function ingest(file: string, url?: string): Promise<number> {
  const here = await wired("ingest", url);
  if (!here) return 1;

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    say(row(0, [badge("memcell"), label("ingest")]), row(1, [bad("cannot read")], [place(file)]));
    return 1;
  }

  try {
    const kept = await call<Kept>(
      here.instance,
      `/api/v1/spaces/${encodeURIComponent(here.space)}/ingest`,
      {
        method: "POST",
        bearer: here.key,
        body: { raw, origin: { title: basename(file) } },
      },
    );
    const created = kept.created.length;
    const reinforced = kept.reinforced.length;
    say(
      row(0, [badge("memcell"), label("ingest"), place(here.space)]),
      created + reinforced > 0
        ? row(
            1,
            [good(`kept ${created}`)],
            reinforced > 0 ? [label("reinforced"), value(String(reinforced))] : null,
            [place(basename(file))],
          )
        : row(1, [warn("kept 0")], kept.note ? [label(kept.note)] : null),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("ingest")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
