import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, id, label, place, row, say, scopeBadge, variant, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell promote <statementId>` — elevate a statement to a broader scope
// (project, team, organization). If direct execution is unauthorized,
// submits a promotion request for peer review.

export async function promote(
  statementId: string,
  toScope: string = "project",
  reason?: string,
  url?: string,
): Promise<number> {
  const here = await wired("promote", url);
  if (!here) return 1;

  let normalizedScope = toScope.trim().toLowerCase();
  if (normalizedScope === "common" || normalizedScope === "proj") {
    normalizedScope = "project";
  } else if (normalizedScope === "org") {
    normalizedScope = "organization";
  }

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const namespace = await resolveNamespace(sdk, undefined);

    let res: any;
    if (typeof (sdk.statements as any)?.promote === "function") {
      res = await (sdk.statements as any).promote(namespace, statementId, {
        toScope: normalizedScope,
        reason,
      });
    } else {
      res = await call(
        here.instance,
        `/api/v1/${namespace}/statements/${encodeURIComponent(statementId)}/promote`,
        {
          method: "POST",
          body: { toScope: normalizedScope, reason },
          bearer: here.key,
        },
      );
    }

    if (res?.promoted !== false && (res?.statement || res?.id)) {
      const stmt = res.statement || res;
      say(
        row(0, [badge("memcell"), label("promote"), place(here.space)]),
        row(
          1,
          [good("promoted")],
          [label("scope"), scopeBadge(stmt.scope || normalizedScope)],
          stmt.version ? [label(`v${stmt.version}`)] : null,
          stmt.title ? [label(stmt.title)] : null,
        ),
        row(2, [id(stmt.id)]),
      );
      return 0;
    }

    const req = res?.promotionRequest || res?.request;
    say(
      row(0, [badge("memcell"), label("promote"), place(here.space)]),
      row(
        1,
        [warn("review requested")],
        [label("target scope"), scopeBadge(req?.toScope || normalizedScope)],
        req?.status ? [label("status"), variant(req.status)] : null,
      ),
      req?.id
        ? row(2, [id(req.id)], [label("statement"), id(statementId)])
        : row(2, [id(statementId)]),
      reason ? row(2, [label("reason:"), label(reason)]) : null,
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
