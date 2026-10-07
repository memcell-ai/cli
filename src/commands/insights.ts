import { call } from "../client.js";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { findWorkspace } from "../workspace.js";
import { resolveOrg } from "./fleet.js";
import {
  bad,
  badge,
  cmd,
  emit,
  good,
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

function missingContext(instance: string): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(
      1,
      [warn("context required")],
      [label("specify --org <slug> or connect a workspace with"), cmd("memcell connect")],
    ),
  );
  return 1;
}

export async function getEnterpriseInsights(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  const targetWs =
    typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);

  // If no org specified, see if workspace context is available
  if (!orgSlug) {
    try {
      const sdk = await getSdkClient(instance);
      const namespace = await resolveNamespace(sdk, targetWs);
      const timeframe =
        typeof flags.timeframe === "string" && ["24h", "7d", "30d"].includes(flags.timeframe.trim())
          ? (flags.timeframe.trim() as "24h" | "7d" | "30d")
          : "30d";

      const parts = namespace.split("/");
      const endpoint = `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/insights?timeframe=${encodeURIComponent(timeframe)}`;
      const wsInsights = await call<any>(instance, endpoint);

      if (flags.json === true) {
        emit(JSON.stringify(wsInsights, null, 2) + "\n");
        return 0;
      }

      say(
        row(
          0,
          [badge("memcell"), label("workspace insights"), place(namespace)],
          [variant(timeframe)],
        ),
      );

      if (wsInsights.cards) {
        say(
          row(
            1,
            [label("Recalls:")],
            [good(String(wsInsights.cards.recalls?.current ?? 0))],
            [label("Remember:")],
            [value(String(wsInsights.cards.remember?.current ?? 0))],
            [label("Report:")],
            [value(String(wsInsights.cards.report?.current ?? 0))],
          ),
        );
      }
      return 0;
    } catch {
      return missingContext(instance);
    }
  }

  const timeframe =
    typeof flags.timeframe === "string" && ["7d", "30d", "90d"].includes(flags.timeframe.trim())
      ? flags.timeframe.trim()
      : "30d";

  try {
    const query = new URLSearchParams();
    query.set("timeframe", timeframe);
    if (typeof flags.team === "string") query.set("teamId", flags.team.trim());
    if (typeof flags.workspace === "string") query.set("workspaceId", flags.workspace.trim());
    else if (typeof flags.project === "string") query.set("workspaceId", flags.project.trim());
    const qs = `?${query.toString()}`;

    const insights = await call<any>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/insights${qs}`,
    );

    if (flags.json === true) {
      emit(JSON.stringify(insights, null, 2) + "\n");
      return 0;
    }

    const { kpis, metrics } = insights;

    say(
      row(
        0,
        [badge("memcell"), label("enterprise insights"), value(orgSlug), place(instance)],
        [variant(timeframe)],
      ),
      row(
        1,
        [label("Dead-End Avoidance:")],
        [
          kpis.deadEndAvoidanceRate >= 95
            ? good(`${kpis.deadEndAvoidanceRate.toFixed(1)}%`)
            : warn(`${kpis.deadEndAvoidanceRate.toFixed(1)}%`),
        ],
        [label("Recall Precision:")],
        [good(`${kpis.recallPrecisionRate.toFixed(1)}%`)],
        [label("Recall Utilization:")],
        [value(`${kpis.recallUtilizationRate.toFixed(1)}%`)],
      ),
      row(
        1,
        [label("Memory Convergence:")],
        [value(`${kpis.memoryConvergenceRate.toFixed(1)}%`)],
        [label("Converged Memories:")],
        [value(`${metrics.convergedMemories ?? 0} / ${metrics.totalMemories ?? 0}`)],
      ),
      row(
        1,
        [label("Tokens Saved:")],
        [good(kpis.tokensSaved.toLocaleString())],
        [label("Estimated Cost Savings:")],
        [good(`$${kpis.estimatedCostSavedUsd.toFixed(2)} USD`)],
      ),
      row(
        1,
        [label("Telemetry Latency:")],
        [label("p50:")],
        [value(`${kpis.latencyMs.p50}ms`)],
        [label("p95:")],
        [value(`${kpis.latencyMs.p95}ms`)],
        [label("p99:")],
        [value(`${kpis.latencyMs.p99}ms`)],
      ),
      row(
        1,
        [label("Execution Summary:")],
        [value(`${metrics.totalRecalls} total recalls`)],
        [good(`${metrics.workedRecalls} worked`)],
        metrics.failedRecalls > 0
          ? [warn(`${metrics.failedRecalls} dead-ends`)]
          : [label("0 dead-ends")],
      ),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}
