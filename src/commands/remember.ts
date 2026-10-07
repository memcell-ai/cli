import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { credentialFor, resolveInstance } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, id, label, place, row, say, scopeBadge, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell remember <text>` — file one finished memory from a shell.
// Hand whole documents or files to `memcell import` instead.

interface Written {
  id: string;
  scope: string;
  confidence: number;
  note: string;
}

/** The five moments a directive can bear on — the record's own words, so a person
 *  filing one by hand can say WHEN it applies and have it served then. */
const APPLIES_AT = ["read", "change", "record", "send", "answer"] as const;

export async function remember(
  text: string,
  type?: string,
  at?: string,
  url?: string,
  scope?: string,
  meta?: string,
  subject?: string,
  roles?: string,
  context?: string,
  observation?: string,
  enforce?: boolean,
  flags?: Record<string, any>,
): Promise<number> {
  // Refused by name rather than dropped: a directive filed as applying at a
  // moment nothing fires would sit here looking wired and never be served.
  const appliesAt = (at ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  const unknown = appliesAt.filter((word) => !(APPLIES_AT as readonly string[]).includes(word));
  if (unknown.length > 0) {
    say(
      row(0, [badge("memcell"), label("remember")]),
      row(1, [bad("no such moment")], [label(unknown.join(", "))]),
      row(2, [label("try")], [value(APPLIES_AT.join(", "))]),
    );
    return 1;
  }

  let parsedMeta: Record<string, unknown> | undefined;
  if (meta) {
    try {
      parsedMeta = JSON.parse(meta);
    } catch {
      say(
        row(0, [badge("memcell"), label("remember")]),
        row(1, [bad("invalid metadata")], [label("metadata must be valid JSON")]),
      );
      return 1;
    }
  }

  let normalizedScope = "workspace";
  if (scope) {
    const s = scope.trim().toLowerCase();
    if (s === "my-memory" || s === "my") {
      normalizedScope = "user";
    } else if (s === "org") {
      normalizedScope = "organization";
    } else if (s === "project") {
      normalizedScope = "workspace";
    } else {
      normalizedScope = s;
    }
  }

  const parsedRoles = roles
    ? roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : undefined;

  return file(
    text,
    type,
    appliesAt,
    url,
    normalizedScope,
    parsedMeta,
    subject,
    parsedRoles,
    context,
    observation,
    enforce,
    flags,
  );
}

async function file(
  text: string,
  type?: string,
  appliesAt: string[] = [],
  url?: string,
  scope: string = "workspace",
  metadata?: Record<string, unknown>,
  subject?: string,
  roles?: string[],
  context?: string,
  observation?: string,
  enforce?: boolean,
  flags?: Record<string, any>,
): Promise<number> {
  const explicitWs =
    typeof flags?.workspace === "string"
      ? flags.workspace
      : typeof flags?.project === "string"
        ? flags.project
        : undefined;

  let instanceUrl: string;
  let bearerToken: string | undefined;
  let targetSpace: string;
  let targetNamespace: string | undefined;

  if (explicitWs) {
    instanceUrl = await resolveInstance(url);
    const cred = await credentialFor(instanceUrl);
    if (!cred) {
      say(
        row(0, [badge("memcell"), bad("remember")]),
        row(1, [bad("not signed in")], [label("run memcell login or set MEMCELL_API_KEY")]),
      );
      return 1;
    }
    bearerToken = cred.token;
    targetSpace = explicitWs;
    const tempSdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    targetNamespace = await resolveNamespace(tempSdk, explicitWs).catch(() => explicitWs);
  } else {
    const here = await wired("remember", url);
    if (!here) return 1;
    instanceUrl = here.instance;
    bearerToken = here.key;
    targetSpace = here.space;
  }

  try {
    const sdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    const payload: any = {
      title: text,
      type: type as any,
      scope,
      subject,
      requiredRoles: roles,
      metadata,
      context,
      observation,
      enforce,
      namespace: targetNamespace,
      workspace: targetNamespace,
    };
    const written = (await sdk.remember(payload)) as any;
    const first = written?.created?.[0] || written;
    const memoryId = first?.id || written?.id;
    const memoryScope = first?.scope || written?.scope || scope;
    const memoryConfidence =
      typeof first?.confidence === "number" ? first.confidence : (written?.confidence ?? 0.55);
    const memoryNote = written?.note || first?.note || "Filed.";

    say(
      row(0, [badge("memcell"), label("remember"), place(targetSpace)]),
      row(
        1,
        [good(memoryNote)],
        [label("confidence"), value(memoryConfidence ? memoryConfidence.toFixed(2) : "0.55")],
        [scopeBadge(memoryScope)],
        subject ? [label("subject"), value(subject)] : null,
      ),
      row(2, [id(memoryId)]),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("remember")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
