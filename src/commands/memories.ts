import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  cmd,
  good,
  id as idSeg,
  label,
  list,
  place,
  row,
  say,
  scopeBadge,
  time,
  value,
  variant,
  warn,
} from "../ui.js";

function getTargetWorkspace(flags: Record<string, string | true>): string | undefined {
  const raw =
    typeof flags.workspace === "string"
      ? flags.workspace
      : typeof flags.project === "string"
        ? flags.project
        : undefined;
  if (!raw) return undefined;
  const ws = raw.trim();
  if (typeof flags.owner === "string" && !ws.includes("/")) {
    return `${flags.owner.trim()}/${ws}`;
  }
  return ws;
}

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

function getMemoriesClient(sdk: any) {
  return sdk.memories ?? sdk.statements;
}

export async function listMemories(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const typeFilter =
      typeof flags.type === "string"
        ? flags.type
        : typeof flags.kind === "string"
          ? flags.kind
          : undefined;

    const page = typeof flags.page === "string" ? parseInt(flags.page, 10) : undefined;
    const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : undefined;
    const status = typeof flags.status === "string" ? (flags.status as any) : undefined;
    let scope: string | undefined;
    if (typeof flags.scope === "string") {
      const s = flags.scope.trim().toLowerCase();
      if (s === "all") {
        scope = undefined;
      } else if (s === "my-memory" || s === "my") {
        scope = "user";
      } else if (s === "org") {
        scope = "organization";
      } else {
        scope = s;
      }
    }
    const q = typeof flags.query === "string" ? flags.query : undefined;

    const res = await memClient.list(namespace, {
      type: typeFilter as any,
      kind: typeFilter as any,
      page: Number.isFinite(page) ? page : undefined,
      perPage: Number.isFinite(limit) ? limit : undefined,
      status,
      scope,
      q,
    });

    const items = res.items || [];
    if (items.length === 0) {
      say(
        row(0, [badge("memcell"), label("memories"), place(namespace)]),
        row(1, [label("no memories found matching criteria")]),
        row(2, [label("record one with"), cmd("memcell memories create <text>")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("memories"), place(namespace)],
        [variant(`${items.length}${res.pagination?.total ? ` of ${res.pagination.total}` : ""}`)],
      ),
      ...items.flatMap((s: any) => [
        row(
          1,
          [value(s.confidence !== undefined ? s.confidence.toFixed(2) : "0.50")],
          s.type ? [variant(s.type)] : null,
          [scopeBadge(s.scope || "workspace")],
          s.status === "pinned" ? [variant("pinned")] : null,
          [label(s.title)],
        ),
        row(2, [idSeg(s.id)]),
      ]),
      row(2, [label("inspect one with"), cmd("memcell memories get <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const s = await memClient.get(namespace, memoryId);

    let rels: { incoming: any[]; outgoing: any[] } = { incoming: [], outgoing: [] };
    try {
      const relNamespace = (memClient as any).relations;
      if (relNamespace?.list) {
        rels = await relNamespace.list(namespace, memoryId);
      } else {
        const parts = namespace.split("/");
        rels = await (sdk as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/relations`,
          { method: "GET" },
        );
      }
    } catch {
      // Non-blocking on memory get
    }

    const hasRelations = (rels.incoming?.length || 0) > 0 || (rels.outgoing?.length || 0) > 0;

    say(
      row(0, [badge("memcell"), label("memory"), place(namespace)], [idSeg(s.id)]),
      row(
        1,
        [value(s.confidence !== undefined ? s.confidence.toFixed(2) : "0.50")],
        s.type ? [variant(s.type)] : null,
        [scopeBadge(s.scope || "workspace")],
        s.status ? [variant(s.status)] : null,
      ),
      row(1, [label("memory:"), value(s.title)]),
      s.context ? row(2, [label("context:"), label(s.context)]) : null,
      (s as any).requiredRoles?.length
        ? row(2, [label("required roles:"), list((s as any).requiredRoles)])
        : null,
      (s as any).scopePromotedAt
        ? row(
            2,
            [label("promoted:")],
            [time(String((s as any).scopePromotedAt))],
            (s as any).scopePromotedBy ? [label(`by ${(s as any).scopePromotedBy}`)] : null,
          )
        : null,
      s.createdAt ? row(2, [label("created:"), time(String(s.createdAt))]) : null,
      ...(hasRelations
        ? [
            row(1, [label("relations:")]),
            ...(rels.outgoing || []).map((r: any) =>
              row(
                2,
                [variant("→")],
                [variant(r.relationType || r.relation_type)],
                [idSeg(r.targetId || r.target_id)],
                r.targetStatement?.title || r.targetMemory?.title
                  ? [label(r.targetStatement?.title || r.targetMemory?.title)]
                  : null,
              ),
            ),
            ...(rels.incoming || []).map((r: any) =>
              row(
                2,
                [variant("←")],
                [variant(r.relationType || r.relation_type)],
                [idSeg(r.sourceId || r.source_id)],
                r.sourceStatement?.title || r.sourceMemory?.title
                  ? [label(r.sourceStatement?.title || r.sourceMemory?.title)]
                  : null,
              ),
            ),
          ]
        : []),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createMemory(
  instance: string,
  memoryText: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const type =
      typeof flags.type === "string"
        ? flags.type
        : typeof flags.kind === "string"
          ? flags.kind
          : undefined;

    let scope: string | undefined;
    if (typeof flags.scope === "string") {
      const s = flags.scope.trim().toLowerCase();
      if (s === "my-memory" || s === "my") {
        scope = "user";
      } else if (s === "org") {
        scope = "organization";
      } else {
        scope = s;
      }
    }

    const roles =
      typeof flags.roles === "string"
        ? flags.roles
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean)
        : undefined;

    const subject =
      typeof flags.subject === "string"
        ? flags.subject
        : typeof flags.target === "string"
          ? flags.target
          : undefined;

    const status = typeof flags.status === "string" ? (flags.status as any) : undefined;

    let metadata: Record<string, unknown> | undefined;
    if (typeof flags.meta === "string") {
      try {
        metadata = JSON.parse(flags.meta);
      } catch {
        say(row(0, [bad("invalid metadata")], [label("must be valid JSON")]));
        return 1;
      }
    }

    const created = await memClient.create(namespace, {
      title: memoryText,
      type: type as any,
      scope,
      status,
      subject,
      requiredRoles: roles,
      metadata,
    } as any);

    say(
      row(0, [badge("memcell"), label("memories create"), place(namespace)]),
      row(
        1,
        [good("created")],
        [value(created.id)],
        [scopeBadge(created.scope || scope || "workspace")],
      ),
      row(2, [label(created.title || memoryText)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const memoryText = typeof flags.text === "string" ? flags.text : undefined;
    const type = typeof flags.type === "string" ? (flags.type as any) : undefined;
    const status = typeof flags.status === "string" ? (flags.status as any) : undefined;

    let metadata: Record<string, unknown> | undefined;
    if (typeof flags.meta === "string") {
      try {
        metadata = JSON.parse(flags.meta);
      } catch {
        say(row(0, [bad("invalid metadata")], [label("must be valid JSON")]));
        return 1;
      }
    }

    const updated = await memClient.update(namespace, memoryId, {
      title: memoryText,
      type,
      status,
      metadata,
    });

    say(
      row(0, [badge("memcell"), label("memories update"), place(namespace)]),
      row(1, [good("updated")], [idSeg(updated.id)]),
      row(2, [label(updated.title)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    await memClient.delete(namespace, memoryId);

    say(
      row(0, [badge("memcell"), label("memories delete"), place(namespace)]),
      row(1, [good("deleted")], [idSeg(memoryId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function starMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const res = await memClient.star(namespace, memoryId);

    say(
      row(0, [badge("memcell"), label("memories star"), place(namespace)]),
      row(1, [good(res.starred ? "starred" : "unstarred")], [idSeg(memoryId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function historyMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const res = await memClient.history(namespace, memoryId);

    say(
      row(0, [badge("memcell"), label("memories history"), place(namespace)], [idSeg(memoryId)]),
      ...((res as any).history || (res as any).items || []).map((h: any) =>
        row(
          1,
          h.version !== undefined ? [variant(`v${h.version}`)] : null,
          [label(h.action || h.changeReason || "revised")],
          h.createdAt ? [time(String(h.createdAt))] : null,
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function adoptMemory(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const into = typeof flags.into === "string" ? flags.into : (flags.to as string | undefined);
    if (!into) {
      say(row(0, [bad("missing target")], [label("specify --into <owner/workspace>")]));
      return 1;
    }

    const res = await memClient.adopt(namespace, memoryId, { targetProjectIds: [into] });
    const targetInfo = res.adopted?.[0];

    say(
      row(0, [badge("memcell"), label("memories adopt"), place(namespace)]),
      row(1, [good("adopted into")], [value(into)]),
      row(2, [idSeg(targetInfo?.statementId || memoryId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function relateMemories(
  instance: string,
  sourceId: string,
  targetId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const relationType = typeof flags.type === "string" ? flags.type : "constrains";
    const confidence = typeof flags.confidence === "string" ? parseFloat(flags.confidence) : 0.9;

    const relNamespace = (memClient as any).relations;
    let rel: any;

    if (relNamespace?.create) {
      rel = await relNamespace.create(namespace, sourceId, {
        targetId,
        relationType,
        confidence,
      });
    } else {
      const parts = namespace.split("/");
      const json = await (sdk as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(sourceId)}/relations`,
        {
          method: "POST",
          body: JSON.stringify({ targetId, relationType, confidence }),
        },
      );
      rel = json.relation;
    }

    say(
      row(0, [badge("memcell"), label("memories relate"), place(namespace)]),
      row(
        1,
        [good("connected")],
        [idSeg(sourceId)],
        [variant(`--${rel.relationType || relationType}-->`)],
        [idSeg(targetId)],
      ),
      row(2, [idSeg(rel.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function unrelateMemories(
  instance: string,
  arg1: string,
  arg2?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const memoryId = arg2 ? arg1 : "_";
    const relationId = arg2 ? arg2 : arg1;

    const relNamespace = (memClient as any).relations;
    if (relNamespace?.delete) {
      await relNamespace.delete(namespace, memoryId, relationId);
    } else {
      const parts = namespace.split("/");
      await (sdk as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/relations/${encodeURIComponent(relationId)}`,
        { method: "DELETE" },
      );
    }

    say(
      row(0, [badge("memcell"), label("memories unrelate"), place(namespace)]),
      row(1, [good("unrelated")], [idSeg(relationId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function memoryRelations(
  instance: string,
  memoryId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const memClient = getMemoriesClient(sdk);
    const target = getTargetWorkspace(flags);
    const namespace = await resolveNamespace(sdk, target);

    const relNamespace = (memClient as any).relations;
    let res: { incoming: any[]; outgoing: any[] };

    if (relNamespace?.list) {
      res = await relNamespace.list(namespace, memoryId);
    } else {
      const parts = namespace.split("/");
      res = await (sdk as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/relations`,
        { method: "GET" },
      );
    }

    const incoming = res.incoming || [];
    const outgoing = res.outgoing || [];

    if (incoming.length === 0 && outgoing.length === 0) {
      say(
        row(0, [badge("memcell"), label("memory relations"), place(namespace)], [idSeg(memoryId)]),
        row(1, [label("no relations declared for this memory")]),
        row(2, [
          label("relate to another with"),
          cmd(`memcell memories relate ${memoryId} <targetId> --type <type>`),
        ]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("memory relations"), place(namespace)],
        [idSeg(memoryId)],
        [variant(`${incoming.length + outgoing.length} total`)],
      ),
      ...outgoing.map((r: any) =>
        row(
          1,
          [variant("→")],
          [variant(r.relationType || r.relation_type)],
          [idSeg(r.targetId || r.target_id)],
          [value(r.confidence !== undefined ? r.confidence.toFixed(2) : "0.90")],
          r.targetStatement?.title || r.targetMemory?.title
            ? [label(r.targetStatement?.title || r.targetMemory?.title)]
            : null,
        ),
      ),
      ...incoming.map((r: any) =>
        row(
          1,
          [variant("←")],
          [variant(r.relationType || r.relation_type)],
          [idSeg(r.sourceId || r.source_id)],
          [value(r.confidence !== undefined ? r.confidence.toFixed(2) : "0.90")],
          r.sourceStatement?.title || r.sourceMemory?.title
            ? [label(r.sourceStatement?.title || r.sourceMemory?.title)]
            : null,
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
