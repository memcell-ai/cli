import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, id, label, place, row, say, scopeBadge, value, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell remember <text>` — file one finished statement from a shell.
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
  typeOrKind?: string,
  at?: string,
  url?: string,
  scope?: string,
  meta?: string,
  subject?: string,
  roles?: string,
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

  let normalizedScope = "project";
  if (scope) {
    const s = scope.trim().toLowerCase();
    if (s === "my-memory" || s === "my") {
      normalizedScope = "user";
    } else if (s === "org") {
      normalizedScope = "organization";
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

  return file(text, typeOrKind, appliesAt, url, normalizedScope, parsedMeta, subject, parsedRoles);
}

async function file(
  text: string,
  typeOrKind?: string,
  appliesAt: string[] = [],
  url?: string,
  scope: string = "project",
  metadata?: Record<string, unknown>,
  subject?: string,
  roles?: string[],
): Promise<number> {
  const here = await wired("remember", url);
  if (!here) return 1;

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const written = (await sdk.remember({
      title: text,
      type: typeOrKind as any,
      kind: typeOrKind as any,
      scope,
      subject,
      requiredRoles: roles,
      metadata,
    } as any)) as unknown as Written;

    say(
      row(0, [badge("memcell"), label("remember"), place(here.space)]),
      row(
        1,
        [good(written.note || "Filed.")],
        [label("confidence"), value(written.confidence ? written.confidence.toFixed(2) : "0.55")],
        [scopeBadge(written.scope || scope)],
        subject ? [label("subject"), value(subject)] : null,
      ),
      row(2, [id(written.id)]),
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
