import { call } from "../client.js";
import { credentialFor } from "../instance.js";
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

export async function getEnterpriseInsights(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const timeframe =
    typeof flags.timeframe === "string" && ["7d", "30d", "90d"].includes(flags.timeframe.trim())
      ? flags.timeframe.trim()
      : "30d";

  try {
    const query = new URLSearchParams();
    query.set("timeframe", timeframe);
    if (typeof flags.team === "string") query.set("teamId", flags.team.trim());
    if (typeof flags.project === "string") query.set("projectId", flags.project.trim());
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
        [label("Converged Statements:")],
        [value(`${metrics.convergedStatements} / ${metrics.totalStatements}`)],
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
