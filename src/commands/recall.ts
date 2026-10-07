import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { credentialFor, resolveInstance } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { bad, badge, emit, id, label, place, row, say, scopeBadge, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell recall <intent>` — what memory serves before acting, from a
// shell. The same API endpoint the hooks and the MCP tool call, so an agent with no
// MCP support reaches the identical answer.

interface Served {
  memoryId: string;
  text: string;
  type?: string | null;
  enforce?: boolean;
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
  limitOrFlags?: string | Record<string, any>,
  url?: string,
  scope?: string,
  scopes?: string,
  myMemory?: boolean,
  meta?: string,
  type?: string,
  enforce?: boolean,
  minConfidence?: string,
  subject?: string,
  format?: string,
  allowProvisional?: boolean,
): Promise<number> {
  const isFlagsObj = typeof limitOrFlags === "object" && limitOrFlags !== null;
  const flags = isFlagsObj ? limitOrFlags : {};

  const effectiveLimit = isFlagsObj
    ? typeof flags.limit === "string"
      ? flags.limit
      : undefined
    : limitOrFlags;
  const effectiveUrl = isFlagsObj ? (typeof flags.url === "string" ? flags.url : undefined) : url;
  const effectiveScope = isFlagsObj
    ? typeof flags.scope === "string"
      ? flags.scope
      : undefined
    : scope;
  const effectiveScopes = isFlagsObj
    ? typeof flags.scopes === "string"
      ? flags.scopes
      : undefined
    : scopes;
  const effectiveMyMemory = isFlagsObj
    ? Boolean(flags["my-memory"] || flags.my || flags.myMemory)
    : Boolean(myMemory);
  const effectiveMeta = isFlagsObj
    ? typeof flags.meta === "string"
      ? flags.meta
      : typeof flags.metadata === "string"
        ? flags.metadata
        : undefined
    : meta;
  const effectiveType = isFlagsObj
    ? typeof flags.type === "string"
      ? flags.type
      : undefined
    : type;
  const effectiveEnforce = isFlagsObj
    ? flags.enforce === true || flags.enforce === "true"
      ? true
      : flags.enforce === false || flags.enforce === "false"
        ? false
        : undefined
    : enforce;
  const effectiveMinConfidence = isFlagsObj
    ? typeof flags["min-confidence"] === "string"
      ? flags["min-confidence"]
      : typeof flags["confidence-floor"] === "string"
        ? flags["confidence-floor"]
        : typeof flags.floor === "string"
          ? flags.floor
          : typeof flags.minConfidence === "string"
            ? flags.minConfidence
            : undefined
    : minConfidence;
  const effectiveSubject = isFlagsObj
    ? typeof flags.subject === "string"
      ? flags.subject
      : typeof flags.target === "string"
        ? flags.target
        : undefined
    : subject;
  const effectiveFormat = isFlagsObj
    ? typeof flags.format === "string"
      ? flags.format
      : undefined
    : format;
  const effectiveProvisional = isFlagsObj
    ? Boolean(flags["allow-provisional"] || flags.provisional || flags.allowProvisional)
    : Boolean(allowProvisional);
  const isJson = isFlagsObj && (flags.json === true || effectiveFormat === "json");

  const explicitWs =
    isFlagsObj && typeof flags.workspace === "string" ? flags.workspace : undefined;

  let instanceUrl: string;
  let bearerToken: string | undefined;
  let targetSpace: string;
  let targetNamespace: string | undefined;

  if (explicitWs) {
    instanceUrl = await resolveInstance(effectiveUrl);
    const cred = await credentialFor(instanceUrl);
    if (!cred) {
      say(
        row(0, [badge("memcell"), bad("recall")]),
        row(1, [bad("not signed in")], [label("run memcell login or set MEMCELL_API_KEY")]),
      );
      return 1;
    }
    bearerToken = cred.token;
    targetSpace = explicitWs;
    const tempSdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    targetNamespace = await resolveNamespace(tempSdk, explicitWs).catch(() => explicitWs);
  } else {
    const here = await wired("recall", effectiveUrl);
    if (!here) return 1;
    instanceUrl = here.instance;
    bearerToken = here.key;
    targetSpace = here.space;
  }

  const asked = Number(effectiveLimit);
  const parsedMinConf = effectiveMinConfidence ? parseFloat(effectiveMinConfidence) : undefined;
  const parsedScopes = effectiveScopes
    ? effectiveScopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let parsedMetadata: Record<string, unknown> | undefined;
  if (effectiveMeta) {
    try {
      parsedMetadata = JSON.parse(effectiveMeta);
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
    const sdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    const recallPayload: any = {
      query: intent,
      namespace: targetNamespace,
      workspace: targetNamespace,
      limit: Number.isFinite(asked) && asked > 0 ? asked : undefined,
      scope: effectiveScope,
      scopes: parsedScopes,
      my_memory: effectiveMyMemory,
      myMemory: effectiveMyMemory,
      metadata: parsedMetadata,
      type: effectiveType as any,
      enforce: effectiveEnforce,
      minConfidence: Number.isFinite(parsedMinConf) ? parsedMinConf : undefined,
      subject: effectiveSubject,
      format: (effectiveFormat as any) ?? "xml",
      allowProvisional: effectiveProvisional,
    };
    const answer = await sdk.recall(recallPayload);

    if (isJson) {
      const outputJson = {
        ...answer,
        memories: (answer as any).memories || (answer as any).results || [],
        results: (answer as any).memories || (answer as any).results || [],
      };
      emit(JSON.stringify(outputJson, null, 2) + "\n");
      return 0;
    }

    if (effectiveFormat === "prompt" || effectiveFormat === "xml") {
      emit(((answer as any).promptContext || "") + "\n");
      return 0;
    }

    const ansAny = answer as any;
    const rawList: any[] = ansAny.memories || ansAny.results || [];
    const results: Served[] = rawList.map((s) => ({
      memoryId: s.memoryId || s.id,
      text: s.text || s.title || "",
      type: s.type,
      enforce: Boolean(s.enforce),
      confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
      layer: s.layer || s.scope || "common",
      vouched: Boolean(s.vouched || s.verified || s.status === "active"),
      verified: Boolean(s.verified || s.vouched || s.status === "active"),
      pinned: Boolean(s.pinned || s.isPinned || s.status === "pinned"),
    }));

    if (results.length === 0) {
      // An empty answer is an answer: memory does not guess.
      say(
        row(0, [badge("memcell"), label("recall"), place(targetSpace)]),
        row(1, [label("nothing established here yet")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("recall"), place(targetSpace)],
        [variant(`${results.length}`)],
      ),
      ...results.flatMap((s) => [
        row(
          1,
          [value(s.confidence.toFixed(2))],
          s.type ? [variant(s.type)] : null,
          s.enforce ? [bad("ENFORCED")] : null,
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
