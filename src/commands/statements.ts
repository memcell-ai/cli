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
  place,
  row,
  say,
  time,
  value,
  variant,
  warn,
} from "../ui.js";

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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
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
    const scope = typeof flags.scope === "string" ? flags.scope : undefined;
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
          s.scope ? [variant(s.scope)] : null,
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
    const namespace = await resolveNamespace(sdk, targetProject);

    const s = await sdk.statements.get(namespace, statementId);

    say(
      row(0, [badge("memcell"), label("statement"), place(namespace)], [idSeg(s.id)]),
      row(
        1,
        [value(s.confidence !== undefined ? s.confidence.toFixed(2) : "0.50")],
        s.type ? [variant(s.type)] : null,
        s.scope ? [variant(s.scope)] : null,
        s.status ? [variant(s.status)] : null,
      ),
      row(1, [label("statement:"), value(s.title)]),
      s.context ? row(2, [label("context:"), label(s.context)]) : null,
      s.createdAt ? row(2, [label("created:"), time(String(s.createdAt))]) : null,
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
    const namespace = await resolveNamespace(sdk, targetProject);

    const type =
      typeof flags.type === "string"
        ? flags.type
        : typeof flags.kind === "string"
          ? flags.kind
          : undefined;

    const scope = typeof flags.scope === "string" ? flags.scope : undefined;
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
      metadata,
    });

    say(
      row(0, [badge("memcell"), label("statements create"), place(namespace)]),
      row(1, [good("created")], [value(created.id)]),
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
    const namespace = await resolveNamespace(sdk, targetProject);

    await sdk.statements.delete(namespace, statementId);

    say(
      row(0, [badge("memcell"), label("statements delete"), place(namespace)]),
      row(1, [good("deleted")], [idSeg(statementId)]),
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
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
    const targetProject = typeof flags.project === "string" ? flags.project : undefined;
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
