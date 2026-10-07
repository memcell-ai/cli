import { MemCellError } from "@memcell/sdk";
import { credentialFor } from "../instance.js";
import { getSdkClient } from "../sdk-client.js";
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

export async function getOperatorStats(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const stats = await sdk.operator.stats();

    if (flags.json === true) {
      emit(JSON.stringify(stats, null, 2) + "\n");
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("operator stats"), place(instance)],
        [variant(stats.version || "v1")],
      ),
      row(
        1,
        [label("Workspaces:")],
        [value(String(stats.totalWorkspaces ?? 0))],
        [label("Memories:")],
        [good(String(stats.totalMemories ?? 0))],
        [label("Agents:")],
        [value(String(stats.totalAgents ?? 0))],
        [label("Users:")],
        [value(String(stats.totalUsers ?? 0))],
      ),
      row(
        2,
        [label("Active recalls (24h):")],
        [good(String(stats.activeRecalls24h ?? 0))],
        [label("Uptime:")],
        [value(`${Math.floor((stats.uptimeSeconds ?? 0) / 3600)}h`)],
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getOperatorAnalytics(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const timeframe = typeof flags.timeframe === "string" ? flags.timeframe : undefined;
    const analytics = await sdk.operator.analytics({ timeframe });

    if (flags.json === true) {
      emit(JSON.stringify(analytics, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("operator analytics"), place(instance)]),
      row(1, [value(JSON.stringify(analytics, null, 2))]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getOperatorConfig(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const config = await sdk.operator.config();

    if (flags.json === true) {
      emit(JSON.stringify(config, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("operator config"), place(instance)]),
      row(1, [value(JSON.stringify(config, null, 2))]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getOperatorLimits(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const limitType =
    typeof flags.type === "string" && ["global", "accounts", "telemetry"].includes(flags.type)
      ? (flags.type as "global" | "accounts" | "telemetry")
      : "global";

  try {
    const sdk = await getSdkClient(instance);
    const limits = await sdk.operator.limits(limitType);

    if (flags.json === true) {
      emit(JSON.stringify(limits, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("operator limit"), variant(limitType), place(instance)]),
      row(1, [value(JSON.stringify(limits, null, 2))]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listOperatorUsers(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const page = typeof flags.page === "string" ? parseInt(flags.page, 10) : 1;
    const perPage = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 25;
    const res = await sdk.operator.users({ page, perPage });

    if (flags.json === true) {
      emit(JSON.stringify(res, null, 2) + "\n");
      return 0;
    }

    const items = res.items || [];
    say(
      row(
        0,
        [badge("memcell"), label("operator user"), place(instance)],
        [variant(`${items.length}`)],
      ),
      ...items.map((u: any) =>
        row(
          1,
          [good(u.email || u.id)],
          [variant(u.role || "user")],
          u.name ? [label(u.name)] : null,
          [idSeg(u.id)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listOperatorWorkspaces(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const page = typeof flags.page === "string" ? parseInt(flags.page, 10) : 1;
    const perPage = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 25;
    const res = await sdk.operator.workspaces({ page, perPage });

    if (flags.json === true) {
      emit(JSON.stringify(res, null, 2) + "\n");
      return 0;
    }

    const items = res.items || [];
    say(
      row(
        0,
        [badge("memcell"), label("operator workspace"), place(instance)],
        [variant(`${items.length}`)],
      ),
      ...items.map((w: any) =>
        row(
          1,
          [good(w.slug || w.name)],
          [label(w.name || "")],
          [variant(w.visibility || "private")],
          w.owner ? [label(`owner: ${w.owner.handle || w.owner.slug || w.owner.id}`)] : null,
          [idSeg(w.id)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
