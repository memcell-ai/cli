import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  cmd,
  good,
  id as idSeg,
  label,
  place,
  row,
  say,
  scopeBadge,
  value,
  variant,
  warn,
} from "../ui.js";

function getTargetWorkspace(flags: Record<string, string | true>): string | undefined {
  if (typeof flags.workspace !== "string") return undefined;
  const ws = flags.workspace.trim();
  if (typeof flags.owner === "string" && !ws.includes("/")) {
    return `${flags.owner.trim()}/${ws}`;
  }
  return ws;
}

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

export async function listPromotions(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const targetWorkspace = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, targetWorkspace);

    const statusParam =
      typeof flags.status === "string" ? flags.status.trim().toLowerCase() : "pending";
    const status = statusParam === "all" ? undefined : statusParam;

    let items: any[] = [];
    let total = 0;

    if (typeof (sdk as any).promotions?.list === "function") {
      const res = await (sdk as any).promotions.list(namespace, { status });
      items = res.items || [];
      total = res.pagination?.total ?? items.length;
    } else {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await call<any>(instance, `/api/v1/${namespace}/promotions${query}`, {
        method: "GET",
      });
      items = res.requests || res.items || res.promotionRequests || [];
      total = res.total ?? items.length;
    }

    if (items.length === 0) {
      say(
        row(0, [badge("memcell"), label("promotion"), place(namespace)]),
        row(1, [label(`no ${status || "pending"} promotion requests found`)]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("promotion"), place(namespace)],
        [variant(`${items.length}${total ? ` of ${total}` : ""} ${status || "pending"}`)],
      ),
      ...items.flatMap((req: any) => [
        row(
          1,
          [variant(req.status || "pending")],
          [scopeBadge(req.fromScope || "user")],
          [variant("→")],
          [scopeBadge(req.toScope || "workspace")],
          req.memory?.title ? [label(req.memory.title)] : [label("memory"), idSeg(req.memoryId)],
        ),
        row(
          2,
          [idSeg(req.id)],
          req.requesterId || req.requestedBy
            ? [label("by"), label(req.requesterId || req.requestedBy)]
            : null,
          req.requesterReason || req.reason
            ? [label("reason:"), label(req.requesterReason || req.reason)]
            : null,
        ),
      ]),
      row(2, [label("review one with"), cmd("memcell promotion approve <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function approvePromotion(
  instance: string,
  requestId: string,
  reason?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const targetWorkspace = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, targetWorkspace);

    let res: any;
    if (typeof (sdk as any).promotions?.approve === "function") {
      res = await (sdk as any).promotions.approve(namespace, requestId, {
        reviewReason: reason,
        reason,
      });
    } else {
      res = await call<any>(
        instance,
        `/api/v1/${namespace}/promotions/${encodeURIComponent(requestId)}/approve`,
        {
          method: "POST",
          body: { reviewReason: reason },
        },
      );
    }

    const mem = res.memory;
    say(
      row(0, [badge("memcell"), label("promotion approve"), place(namespace)]),
      row(
        1,
        [good("approved")],
        mem?.scope ? [scopeBadge(mem.scope)] : null,
        mem?.title ? [label(mem.title)] : null,
      ),
      row(2, [idSeg(requestId)], mem?.id ? [label("memory"), idSeg(mem.id)] : null),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function rejectPromotion(
  instance: string,
  requestId: string,
  reason?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const targetWorkspace = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, targetWorkspace);

    if (typeof (sdk as any).promotions?.reject === "function") {
      await (sdk as any).promotions.reject(namespace, requestId, {
        reviewReason: reason,
        reason,
      });
    } else {
      await call<any>(
        instance,
        `/api/v1/${namespace}/promotions/${encodeURIComponent(requestId)}/reject`,
        {
          method: "POST",
          body: { reviewReason: reason },
        },
      );
    }

    say(
      row(0, [badge("memcell"), label("promotion reject"), place(namespace)]),
      row(1, [bad("rejected")], [label("request"), idSeg(requestId)]),
      reason ? row(2, [label("reason:"), label(reason)]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
