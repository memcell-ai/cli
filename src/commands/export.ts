import { writeFile } from "node:fs/promises";
import { call, MemcellError } from "../client.js";
import { aside, badge, bad, emit, good, label, place, row, say, value, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell export` — everything this directory's memory holds, carried out.
//
// No account, no ceremony, forever: the connection is the credential, the
// same pair key the hooks act on every turn, and everything it answers can
// already leave through that key's recall. Memory your agents filled is
// yours — the export exists so that is a fact rather than a promise.
//
// Formats are the files other agents already read, so leaving (or just
// keeping a copy in the repo) needs no translator afterwards.

interface ExportedMemory {
  id?: string;
  memoryId?: string;
  text: string;
  title?: string;
  type?: string | null;
  tags?: string[];
  scope: string;
  status: string;
  confidence: number;
  context: Record<string, string> | null;
  createdAt: string;
  evidence: { role: string; title: string; ref: string | null; quote: string | null }[];
}

interface ExportDoc {
  space: { slug: string; name: string; exportedAt: string };
  memories: ExportedMemory[];
}

export const EXPORT_FORMATS = ["json", "agents-md", "claude-md", "cursorrules"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The types, in the order a reader wants them: what was decided, what must
 *  be followed, what to avoid, then everything known. */
const SECTIONS: [title: string, types: (string | null)[]][] = [
  ["Directives & Guards", ["directive", "guard"]],
  ["Preferences", ["preference"]],
  ["Observations & Learnings", ["observation"]],
  ["Facts", ["fact", null]],
];

/** A memory as one Markdown line: the claim, then its condition. */
function lineOf(s: ExportedMemory): string {
  const when = s.context?.when ? ` *(applies when ${s.context.when})*` : "";
  return `- ${s.text}${when}`;
}

export function renderMarkdown(doc: ExportDoc, heading: string): string {
  const items = doc.memories || [];
  const live = items.filter((s) => s.status === "active");
  const parts = [
    `# ${heading}`,
    "",
    `What ${doc.space.name} knows — ${live.length} memor${live.length === 1 ? "y" : "ies"}, exported from memcell on ${doc.space.exportedAt.slice(0, 10)}.`,
  ];
  const placed = new Set<ExportedMemory>();
  for (const [title, types] of SECTIONS) {
    const here = live.filter((s) => !placed.has(s) && types.includes(s.type ?? null));
    if (here.length === 0) continue;
    here.forEach((s) => placed.add(s));
    parts.push("", `## ${title}`, "", ...here.map(lineOf));
  }
  const rest = live.filter((s) => !placed.has(s));
  if (rest.length > 0) parts.push("", "## Also held", "", ...rest.map(lineOf));
  return parts.join("\n") + "\n";
}

export function renderCursorrules(doc: ExportDoc): string {
  const items = doc.memories || [];
  const live = items.filter((s) => s.status === "active");
  return (
    [
      `# ${doc.space.name} — exported from memcell ${doc.space.exportedAt.slice(0, 10)}`,
      ...live.map((s) => lineOf(s).replace(/^- /, "")),
    ].join("\n") + "\n"
  );
}

export async function exportSpace(
  format: string,
  out?: string,
  url?: string,
  targetProject?: string,
): Promise<number> {
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
    say(
      row(0, [badge("memcell"), label("export")]),
      row(1, [warn(`no format called ${format}`)], [value(EXPORT_FORMATS.join(" · "))]),
    );
    return 1;
  }

  const hasProject = Boolean(targetProject);
  const here = await wired("export", url, { silent: hasProject });

  let targetSpace: string;
  let targetInstance = url ?? "http://localhost:3000";
  let targetBearer: string | undefined;

  if (here) {
    targetSpace = here.space;
    targetInstance = here.instance;
    targetBearer = here.key;
  } else if (targetProject) {
    targetSpace = targetProject;
  } else {
    return 1;
  }

  let doc: ExportDoc;
  try {
    const exportPath = targetBearer
      ? "/api/v1/export"
      : `/api/v1/export?project=${encodeURIComponent(targetSpace)}`;
    doc = await call<ExportDoc>(targetInstance, exportPath, {
      method: "GET",
      bearer: targetBearer,
    });
  } catch (error) {
    if (error instanceof MemcellError) {
      say(
        row(0, [badge("memcell"), label("export")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }

  const rendered =
    format === "json"
      ? JSON.stringify(doc, null, 2) + "\n"
      : format === "cursorrules"
        ? renderCursorrules(doc)
        : renderMarkdown(
            doc,
            format === "claude-md" ? "CLAUDE.md — project memory" : "Project memory",
          );

  const totalCount = (doc.memories || []).length;
  if (out) {
    await writeFile(out, rendered);
    say(
      row(0, [badge("memcell"), label("export"), place(targetSpace)]),
      row(1, [good(`${totalCount} memories`)], [value(format)], [place(out)]),
    );
  } else {
    // The document itself, piped clean; the receipt rides beside it.
    emit(rendered);
    aside(
      row(0, [badge("memcell"), label("export"), place(targetSpace)]),
      row(1, [good(`${totalCount} memories`)], [value(format)]),
    );
  }
  return 0;
}
