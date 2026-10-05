import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, id, label, place, row, say, scopeBadge, variant, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell promote <memoryId>` — elevate a memory to a broader scope
// (workspace, team, organization). If direct execution is unauthorized,
// submits a promotion request for peer review.

export async function promote(
  memoryId: string,
  toScope: string = "workspace",
  reason?: string,
  url?: string,
): Promise<number> {
  const here = await wired("promote", url);
  if (!here) return 1;

  let normalizedScope = toScope.trim().toLowerCase();
  if (normalizedScope === "common" || normalizedScope === "proj" || normalizedScope === "project") {
    normalizedScope = "workspace";
  } else if (normalizedScope === "org") {
    normalizedScope = "organization";
  }

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const namespace = await resolveNamespace(sdk, undefined);

    let res: any;
    if (typeof (sdk.memories as any)?.promote === "function") {
      res = await (sdk.memories as any).promote(namespace, memoryId, {
        toScope: normalizedScope,
        reason,
      });
    } else {
      res = await call(
        here.instance,
        `/api/v1/${namespace}/memories/${encodeURIComponent(memoryId)}/promote`,
        {
          method: "POST",
          body: { toScope: normalizedScope, reason },
          bearer: here.key,
        },
      );
    }

    if (res?.promoted !== false && (res?.memory || res?.statement || res?.id)) {
      const mem = res.memory || res.statement || res;
      say(
        row(0, [badge("memcell"), label("promote"), place(here.space)]),
        row(
          1,
          [good("promoted")],
          [label("scope"), scopeBadge(mem.scope || normalizedScope)],
          mem.version ? [label(`v${mem.version}`)] : null,
          mem.title ? [label(mem.title)] : null,
        ),
        row(2, [id(mem.id)]),
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
      req?.id ? row(2, [id(req.id)], [label("memory"), id(memoryId)]) : row(2, [id(memoryId)]),
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
