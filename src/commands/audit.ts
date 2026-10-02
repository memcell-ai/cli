import * as fs from "node:fs/promises";
import * as path from "node:path";
import { call } from "../client.js";
import { credentialFor } from "../instance.js";
import { resolveOrg } from "./fleet.js";
import {
  bad,
  badge,
  cmd,
  emit,
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

function missingOrg(instance: string): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(
      1,
      [warn("organization required")],
      [label("specify --org <slug> or set active org with"), cmd("memcell orgs use <slug>")],
    ),
  );
  return 1;
}

export async function listAuditLogs(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const query = new URLSearchParams();
    if (typeof flags.actor === "string") query.set("actorId", flags.actor.trim());
    if (typeof flags["actor-type"] === "string") query.set("actorType", flags["actor-type"].trim());
    if (typeof flags.action === "string") query.set("action", flags.action.trim());
    if (typeof flags["target-type"] === "string")
      query.set("targetType", flags["target-type"].trim());
    if (typeof flags["target-id"] === "string") query.set("targetId", flags["target-id"].trim());
    if (typeof flags.project === "string") query.set("projectId", flags.project.trim());
    if (typeof flags.team === "string") query.set("teamId", flags.team.trim());
    if (typeof flags.from === "string") query.set("from", flags.from.trim());
    if (typeof flags.to === "string") query.set("to", flags.to.trim());
    if (typeof flags.limit === "string") query.set("perPage", flags.limit.trim());
    const qs = query.toString() ? `?${query.toString()}` : "";

    const res = await call<{ events: any[] }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/audit-logs${qs}`,
    );
    const events = res.events || [];

    if (flags.json === true) {
      emit(JSON.stringify(events, null, 2) + "\n");
      return 0;
    }

    if (events.length === 0) {
      say(
        row(0, [badge("memcell"), label("audit logs"), value(orgSlug), place(instance)]),
        row(1, [label("no audit events match the specified filters")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("audit logs"), value(orgSlug), place(instance)],
        [variant(`${events.length} events`)],
      ),
      ...events.map((ev) => {
        const isKillSwitch = ev.action.includes("suspend") || ev.action.includes("kill");
        const actionBadge = isKillSwitch ? bad(ev.action) : variant(ev.action);
        const actorStr = ev.actorName || ev.actorId || "system";

        return row(
          1,
          [time(String(ev.createdAt))],
          [actionBadge],
          [label("by:")],
          [value(actorStr)],
          [label(`target:`)],
          [label(ev.targetType)],
          [idSeg(ev.targetId)],
          ev.ipAddress ? [label(ev.ipAddress)] : [],
        );
      }),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function exportAuditLogs(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const format =
    typeof flags.format === "string" &&
    ["cef", "json", "csv"].includes(flags.format.trim().toLowerCase())
      ? flags.format.trim().toLowerCase()
      : "cef";

  try {
    const query = new URLSearchParams();
    query.set("format", format);
    if (typeof flags.from === "string") query.set("from", flags.from.trim());
    if (typeof flags.to === "string") query.set("to", flags.to.trim());
    if (typeof flags.action === "string") query.set("action", flags.action.trim());
    if (typeof flags.project === "string") query.set("projectId", flags.project.trim());
    const qs = `?${query.toString()}`;

    const exportData = await call<string>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/audit-logs/export${qs}`,
      { raw: true },
    );

    const outFile = typeof flags.out === "string" ? flags.out.trim() : undefined;

    if (outFile) {
      const resolvedPath = path.resolve(process.cwd(), outFile);
      await fs.writeFile(resolvedPath, exportData, "utf8");

      say(
        row(0, [badge("memcell"), label("audit export"), place(instance)]),
        row(1, [good("exported audit logs")], [value(resolvedPath)]),
        row(
          2,
          [label("format:")],
          [variant(format)],
          [label("bytes:")],
          [value(String(Buffer.byteLength(exportData)))],
        ),
      );
      return 0;
    }

    emit(exportData.endsWith("\n") ? exportData : `${exportData}\n`);
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}
