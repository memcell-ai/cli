import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import type { ResolvedContext } from "../model.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  cmd,
  emit,
  id as idSeg,
  label,
  place,
  row,
  say,
  state,
  time,
  value,
  variant,
  warn,
} from "../ui.js";

function getTargetWorkspace(
  flags: Record<string, string | true>,
  context?: ResolvedContext | null,
): string | undefined {
  const wsRaw = typeof flags.workspace === "string" ? flags.workspace : undefined;
  if (wsRaw) {
    const ws = wsRaw.trim();
    if (typeof flags.owner === "string" && !ws.includes("/")) {
      return `${flags.owner.trim()}/${ws}`;
    }
    return ws;
  }
  return context?.workspace?.namespace || context?.project?.namespace;
}

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

const PHASE_LABELS: Record<string, string> = {
  clustering: "identifying dense semantic neighborhoods",
  synthesizing: "arbitrating clusters & synthesizing fusions",
  fusing: "crystallizing canonical fusions & lineage",
  linking_edges: "constructing epistemic relation graph",
  surfacing_tensions: "surfacing contradictions & contested claims",
  refreshing_profile: "updating project living profile",
};

export async function sweepConsolidate(
  instance: string,
  flags: Record<string, string | true> = {},
  context?: ResolvedContext | null,
): Promise<number> {
  const isJson = Boolean(flags.json);
  try {
    const sdk = await getSdkClient(instance);
    const targetWorkspace = getTargetWorkspace(flags, context);
    const namespace = await resolveNamespace(sdk, targetWorkspace);

    const minSimilarity =
      typeof flags["min-similarity"] === "string" ? parseFloat(flags["min-similarity"]) : undefined;
    const minClusterSize =
      typeof flags["min-cluster-size"] === "string"
        ? parseInt(flags["min-cluster-size"], 10)
        : undefined;
    const maxClusterSize =
      typeof flags["max-cluster-size"] === "string"
        ? parseInt(flags["max-cluster-size"], 10)
        : undefined;
    const shouldWait = flags["no-wait"] !== true && flags.wait !== "false";

    const sweepRes: { jobId: string; phases: string[] } =
      typeof (sdk as any).sweep?.consolidate === "function"
        ? await (sdk as any).sweep.consolidate(namespace, {
            minSimilarity: Number.isFinite(minSimilarity) ? minSimilarity : undefined,
            minClusterSize: Number.isFinite(minClusterSize) ? minClusterSize : undefined,
            maxClusterSize: Number.isFinite(maxClusterSize) ? maxClusterSize : undefined,
          })
        : await call<{ jobId: string; phases: string[] }>(
            instance,
            `/api/v1/${namespace}/lifecycle/sweep/consolidate`,
            {
              method: "POST",
              body: {
                minSimilarity: Number.isFinite(minSimilarity) ? minSimilarity : undefined,
                minClusterSize: Number.isFinite(minClusterSize) ? minClusterSize : undefined,
                maxClusterSize: Number.isFinite(maxClusterSize) ? maxClusterSize : undefined,
              },
            },
          );

    const { jobId, phases } = sweepRes;

    if (!shouldWait) {
      if (isJson) {
        emit(JSON.stringify({ jobId, phases, status: "accepted" }, null, 2) + "\n");
      } else {
        say(
          row(0, [badge("memcell"), label("consolidation sweep"), place(namespace)]),
          row(1, [state("good", "sweep queued")], [label("job"), idSeg(jobId)]),
          row(2, [label("phases"), variant(phases.join(" → "))]),
        );
      }
      return 0;
    }

    if (!isJson) {
      say(
        row(0, [badge("memcell"), label("consolidation sweep"), place(namespace)]),
        row(1, [state("accent", "clustering memories")], [label("job"), idSeg(jobId)]),
      );
    }

    let lastPhase = "";
    const jobEvent = await sdk.waitForJob(jobId, {
      timeoutMs: 120000,
      onProgress: (event) => {
        if (!isJson && event.step && event.step !== lastPhase && event.step !== "completed") {
          lastPhase = event.step;
          const phaseText = PHASE_LABELS[event.step] || event.message || event.step;
          say(
            row(
              1,
              [state("accent", phaseText)],
              typeof event.progress === "number" ? [value(`${event.progress}%`)] : null,
            ),
          );
        }
      },
    });

    const result = (jobEvent.metadata as Record<string, any>) || {};

    if (isJson) {
      emit(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    const dur =
      typeof result.durationMs === "number"
        ? `${(result.durationMs / 1000).toFixed(2)}s`
        : undefined;

    say(
      row(
        0,
        [badge("memcell"), label("sweep complete"), place(namespace)],
        dur ? [time(dur)] : null,
      ),
      row(1, [label("examined")], [value(String(result.examinedCount ?? 0)), label("memories")]),
      row(
        1,
        [label("clusters")],
        [value(String(result.clusterCount ?? 0)), label("semantic neighborhoods identified")],
      ),
      row(
        1,
        [label("fusions")],
        [value(String(result.fusionsCount ?? 0)), label("canonical memories created")],
      ),
      row(
        1,
        [label("relations")],
        [value(String(result.relationsCount ?? 0)), label("epistemic edges linked")],
      ),
      row(
        1,
        [label("tensions")],
        [value(String(result.tensionsCount ?? 0)), label("contradictions surfaced")],
      ),
      result.profileUpdated ? row(1, [state("good", "profile regenerated")]) : null,
    );

    if ((result.tensionsCount ?? 0) > 0) {
      say(
        row(2, [state("warn", `${result.tensionsCount} tension(s) surfaced for human review`)]),
        row(2, [label("inspect with"), cmd("memcell memories --status contested")]),
      );
    }
    if ((result.fusionsCount ?? 0) > 0) {
      say(
        row(2, [
          label("inspect canonical memories with"),
          cmd("memcell memories --type directive"),
        ]),
      );
    }

    return 0;
  } catch (error) {
    if (error instanceof MemCellError || error instanceof MemcellError) {
      return refused(instance, error);
    }
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn(error instanceof Error ? error.message : "consolidation sweep failed")]),
    );
    return 1;
  }
}
