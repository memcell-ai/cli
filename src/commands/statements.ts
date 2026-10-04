import { MemCellError } from "@memcell/sdk";
import { MemcellError, call } from "../client.js";
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

function getTargetProject(flags: Record<string, string | true>): string | undefined {
  const raw =
    typeof flags.workspace === "string"
      ? flags.workspace
      : typeof flags.project === "string"
        ? flags.project
        : undefined;
  if (!raw) return undefined;
  const proj = raw.trim();
  if (typeof flags.owner === "string" && !proj.includes("/")) {
    return `${flags.owner.trim()}/${proj}`;
  }
  return proj;
}

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

export async function listStatements(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

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

    const res = await sdk.statements.list(namespace, {
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
        row(0, [badge("memcell"), label("statements"), place(namespace)]),
        row(1, [label("no statements found matching criteria")]),
        row(2, [label("file one with"), cmd("memcell statements create <text>")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("statements"), place(namespace)],
        [variant(`${items.length}${res.pagination?.total ? ` of ${res.pagination.total}` : ""}`)],
      ),
      ...items.flatMap((s) => [
        row(
          1,
          [value(s.confidence !== undefined ? s.confidence.toFixed(2) : "0.50")],
          s.type ? [variant(s.type)] : null,
          [scopeBadge(s.scope || "project")],
          s.status === "pinned" ? [variant("pinned")] : null,
          [label(s.title)],
        ),
        row(2, [idSeg(s.id)]),
      ]),
      row(2, [label("inspect one with"), cmd("memcell statements get <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const s = await sdk.statements.get(namespace, statementId);

    let rels: { incoming: any[]; outgoing: any[] } = { incoming: [], outgoing: [] };
    try {
      const relNamespace = (sdk.statements as any).relations;
      if (relNamespace?.list) {
        rels = await relNamespace.list(namespace, statementId);
      } else {
        const parts = namespace.split("/");
        rels = await (sdk as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/statements/${encodeURIComponent(statementId)}/relations`,
          { method: "GET" },
        );
      }
    } catch {
      // Non-blocking on statement get
    }

    const hasRelations = (rels.incoming?.length || 0) > 0 || (rels.outgoing?.length || 0) > 0;

    say(
      row(0, [badge("memcell"), label("statement"), place(namespace)], [idSeg(s.id)]),
      row(
        1,
        [value(s.confidence !== undefined ? s.confidence.toFixed(2) : "0.50")],
        s.type ? [variant(s.type)] : null,
        [scopeBadge(s.scope || "project")],
        s.status ? [variant(s.status)] : null,
      ),
      row(1, [label("statement:"), value(s.title)]),
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
                r.targetStatement?.title ? [label(r.targetStatement.title)] : null,
              ),
            ),
            ...(rels.incoming || []).map((r: any) =>
              row(
                2,
                [variant("←")],
                [variant(r.relationType || r.relation_type)],
                [idSeg(r.sourceId || r.source_id)],
                r.sourceStatement?.title ? [label(r.sourceStatement.title)] : null,
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

export async function createStatement(
  instance: string,
  statementText: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

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

    const created = await sdk.statements.create(namespace, {
      title: statementText,
      type: type as any,
      scope,
      status,
      subject,
      requiredRoles: roles,
      metadata,
    } as any);

    say(
      row(0, [badge("memcell"), label("statements create"), place(namespace)]),
      row(
        1,
        [good("created")],
        [value(created.id)],
        [scopeBadge(created.scope || scope || "project")],
      ),
      row(2, [label(created.title || statementText)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const statementText = typeof flags.text === "string" ? flags.text : undefined;
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

    const updated = await sdk.statements.update(namespace, statementId, {
      title: statementText,
      type,
      status,
      metadata,
    });

    say(
      row(0, [badge("memcell"), label("statements update"), place(namespace)]),
      row(1, [good("updated")], [idSeg(updated.id)]),
      row(2, [label(updated.title)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);
    const allVersions = Boolean(flags.all);
    const query = allVersions ? "?allVersions=true" : "";

    const res = await call<any>(
      instance,
      `/api/v1/${namespace}/statements/${encodeURIComponent(statementId)}${query}`,
      { method: "DELETE" },
    );

    const detail =
      res?.deletedScope === "version"
        ? `pruned latest version (restored v${res.restoredVersion})`
        : "deleted";

    say(
      row(0, [badge("memcell"), label("statements delete"), place(namespace)]),
      row(1, [good(detail)], [idSeg(statementId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function starStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const res = await sdk.statements.star(namespace, statementId);

    say(
      row(0, [badge("memcell"), label("statements star"), place(namespace)]),
      row(1, [good(res.starred ? "starred" : "unstarred")], [idSeg(statementId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function historyStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const res = await sdk.statements.history(namespace, statementId);

    say(
      row(
        0,
        [badge("memcell"), label("statements history"), place(namespace)],
        [idSeg(statementId)],
      ),
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

export async function adoptStatement(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const into = typeof flags.into === "string" ? flags.into : (flags.to as string | undefined);
    if (!into) {
      say(row(0, [bad("missing target")], [label("specify --into <owner/project>")]));
      return 1;
    }

    const res = await sdk.statements.adopt(namespace, statementId, { targetProjectIds: [into] });
    const targetInfo = res.adopted?.[0];

    say(
      row(0, [badge("memcell"), label("statements adopt"), place(namespace)]),
      row(1, [good("adopted into")], [value(into)]),
      row(2, [idSeg(targetInfo?.statementId || statementId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function relateStatements(
  instance: string,
  sourceId: string,
  targetId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const relationType = typeof flags.type === "string" ? flags.type : "constrains";
    const confidence = typeof flags.confidence === "string" ? parseFloat(flags.confidence) : 0.9;

    const relNamespace = (sdk.statements as any).relations;
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
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/statements/${encodeURIComponent(sourceId)}/relations`,
        {
          method: "POST",
          body: JSON.stringify({ targetId, relationType, confidence }),
        },
      );
      rel = json.relation;
    }

    say(
      row(0, [badge("memcell"), label("statements relate"), place(namespace)]),
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

export async function unrelateStatements(
  instance: string,
  arg1: string,
  arg2?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const statementId = arg2 ? arg1 : "_";
    const relationId = arg2 ? arg2 : arg1;

    const relNamespace = (sdk.statements as any).relations;
    if (relNamespace?.delete) {
      await relNamespace.delete(namespace, statementId, relationId);
    } else {
      const parts = namespace.split("/");
      await (sdk as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/statements/${encodeURIComponent(statementId)}/relations/${encodeURIComponent(relationId)}`,
        { method: "DELETE" },
      );
    }

    say(
      row(0, [badge("memcell"), label("statements unrelate"), place(namespace)]),
      row(1, [good("unrelated")], [idSeg(relationId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function statementRelations(
  instance: string,
  statementId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  try {
    const sdk = await getSdkClient(instance);
    const targetProject = getTargetProject(flags);
    const namespace = await resolveNamespace(sdk, targetProject);

    const relNamespace = (sdk.statements as any).relations;
    let res: { incoming: any[]; outgoing: any[] };

    if (relNamespace?.list) {
      res = await relNamespace.list(namespace, statementId);
    } else {
      const parts = namespace.split("/");
      res = await (sdk as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/statements/${encodeURIComponent(statementId)}/relations`,
        { method: "GET" },
      );
    }

    const incoming = res.incoming || [];
    const outgoing = res.outgoing || [];

    if (incoming.length === 0 && outgoing.length === 0) {
      say(
        row(
          0,
          [badge("memcell"), label("statement relations"), place(namespace)],
          [idSeg(statementId)],
        ),
        row(1, [label("no relations declared for this statement")]),
        row(2, [
          label("relate to another with"),
          cmd(`memcell statements relate ${statementId} <targetId> --type <type>`),
        ]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("statement relations"), place(namespace)],
        [idSeg(statementId)],
        [variant(`${incoming.length + outgoing.length} total`)],
      ),
      ...outgoing.map((r: any) =>
        row(
          1,
          [variant("→")],
          [variant(r.relationType || r.relation_type)],
          [idSeg(r.targetId || r.target_id)],
          [value(r.confidence !== undefined ? r.confidence.toFixed(2) : "0.90")],
          r.targetStatement?.title ? [label(r.targetStatement.title)] : null,
        ),
      ),
      ...incoming.map((r: any) =>
        row(
          1,
          [variant("←")],
          [variant(r.relationType || r.relation_type)],
          [idSeg(r.sourceId || r.source_id)],
          [value(r.confidence !== undefined ? r.confidence.toFixed(2) : "0.90")],
          r.sourceStatement?.title ? [label(r.sourceStatement.title)] : null,
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
