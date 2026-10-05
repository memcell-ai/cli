import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, id, label, place, row, say, scopeBadge, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell recall <intent>` — what memory serves before acting, from a
// shell. The same API endpoint the hooks and the MCP tool call, so an agent with no
// MCP support reaches the identical answer.

interface Served {
  memoryId: string;
  text: string;
  type?: string | null;
  confidence: number;
  layer?: string;
  vouched?: boolean;
  verified?: boolean;
  /** Here because the space pins it, not because it matched. Marked, so
   *  presence is never read as an answer to what was asked. */
  pinned?: boolean;
}

export async function recall(
  intent: string,
  limit?: string,
  url?: string,
  scope?: string,
  scopes?: string,
  myMemory?: boolean,
  meta?: string,
): Promise<number> {
  const here = await wired("recall", url);
  if (!here) return 1;

  const asked = Number(limit);
  const parsedScopes = scopes
    ? scopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let parsedMetadata: Record<string, unknown> | undefined;
  if (meta) {
    try {
      parsedMetadata = JSON.parse(meta);
      if (
        typeof parsedMetadata !== "object" ||
        parsedMetadata === null ||
        Array.isArray(parsedMetadata)
      ) {
        throw new Error("Metadata must be a JSON object");
      }
    } catch {
      say(
        row(0, [
          badge("memcell"),
          bad("recall"),
          label("invalid --meta JSON: must be a valid JSON object"),
        ]),
      );
      return 1;
    }
  }

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const answer = await sdk.recall({
      query: intent,
      limit: Number.isFinite(asked) && asked > 0 ? asked : undefined,
      scope,
      scopes: parsedScopes,
      my_memory: myMemory,
      myMemory,
      metadata: parsedMetadata,
    } as any);

    const ansAny = answer as any;
    const rawList: any[] = ansAny.memories || ansAny.results || [];
    const results: Served[] = rawList.map((s) => ({
      memoryId: s.memoryId || s.id,
      text: s.text || s.title || "",
      type: s.type,
      confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
      layer: s.layer || s.scope || "common",
      vouched: Boolean(s.vouched || s.verified || s.status === "active"),
      verified: Boolean(s.verified || s.vouched || s.status === "active"),
      pinned: Boolean(s.pinned || s.isPinned || s.status === "pinned"),
    }));

    if (results.length === 0) {
      // An empty answer is an answer: memory does not guess.
      say(
        row(0, [badge("memcell"), label("recall"), place(here.space)]),
        row(1, [label("nothing established here yet")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("recall"), place(here.space)],
        [variant(`${results.length}`)],
      ),
      ...results.flatMap((s) => [
        row(
          1,
          [value(s.confidence.toFixed(2))],
          s.type ? [variant(s.type)] : null,
          [scopeBadge(s.layer || "workspace")],
          s.pinned ? [variant("pinned")] : null,
          !(s.verified ?? s.vouched) ? [variant("unvouched")] : null,
          [label(s.text)],
        ),
        // The id, because reporting an outcome on this needs it.
        row(2, [id(s.memoryId)]),
      ]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("recall")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
