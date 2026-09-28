import { call, MemcellError } from "../client.js";
import { badge, bad, good, id, label, place, row, say, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell promote <statementId>` — administratively elevate a statement from
// a localized scope (e.g. domain:*, session:*) to the common baseline.

interface PromotedResponse {
  promoted: boolean;
  statement: {
    id: string;
    scope: string;
    version: number;
    title: string;
  };
}

export async function promote(
  statementId: string,
  toScope: string = "common",
  reason?: string,
  url?: string,
): Promise<number> {
  const here = await wired("promote", url);
  if (!here) return 1;

  try {
    const res = await call<PromotedResponse>(
      here.instance,
      `/api/v1/statements/${encodeURIComponent(statementId)}/promote`,
      {
        method: "POST",
        bearer: here.key,
        body: {
          toScope,
          reason,
        },
      },
    );

    say(
      row(0, [badge("memcell"), label("promote"), place(here.space)]),
      row(
        1,
        [good("promoted")],
        [label("scope"), variant(res.statement.scope)],
        [label(`v${res.statement.version}`)],
        [label(res.statement.title)],
      ),
      row(2, [id(res.statement.id)]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("promote")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
