import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, id, label, place, row, say, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell promote <statementId>` — administratively elevate a statement from
// a localized scope (e.g. domain:*, session:*) to the common baseline.

export async function promote(
  statementId: string,
  toScope: string = "common",
  reason?: string,
  url?: string,
): Promise<number> {
  const here = await wired("promote", url);
  if (!here) return 1;

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const namespace = await resolveNamespace(sdk, undefined);
    const res = await sdk.statements.promote(namespace, statementId, {
      toScope,
      reason,
    });

    const stmt = res.statement;
    say(
      row(0, [badge("memcell"), label("promote"), place(here.space)]),
      row(
        1,
        [good("promoted")],
        [label("scope"), variant(stmt.scope || toScope)],
        (stmt as any).version ? [label(`v${(stmt as any).version}`)] : null,
        stmt.title ? [label(stmt.title)] : null,
      ),
      row(2, [id(stmt.id)]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("promote")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
