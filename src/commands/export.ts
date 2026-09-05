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

interface ExportedStatement {
  text: string;
  kind: string | null;
  scope: string;
  status: string;
  confidence: number;
  context: Record<string, string> | null;
  createdAt: string;
  evidence: { role: string; title: string; ref: string | null; quote: string | null }[];
}

interface ExportDoc {
  space: { slug: string; name: string; exportedAt: string };
  statements: ExportedStatement[];
}

export const EXPORT_FORMATS = ["json", "agents-md", "claude-md", "cursorrules"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The kinds, in the order a reader wants them: what was decided, what must
 *  be followed, what to avoid, then everything known. */
const SECTIONS: [title: string, kinds: (string | null)[]][] = [
  ["Decisions", ["decision"]],
  ["Conventions", ["convention", "preference"]],
  ["Gotchas", ["gotcha"]],
  ["Dead ends — do not retry", ["dead_end"]],
  ["Facts", ["fact", null]],
];

/** A statement as one Markdown line: the claim, then its condition. */
function lineOf(s: ExportedStatement): string {
  const when = s.context?.when ? ` *(applies when ${s.context.when})*` : "";
  return `- ${s.text}${when}`;
}

export function renderMarkdown(doc: ExportDoc, heading: string): string {
  const live = doc.statements.filter((s) => s.status === "active");
  const parts = [
    `# ${heading}`,
    "",
    `What ${doc.space.name} knows — ${live.length} statement${live.length === 1 ? "" : "s"}, exported from memcell on ${doc.space.exportedAt.slice(0, 10)}.`,
  ];
  const placed = new Set<ExportedStatement>();
  for (const [title, kinds] of SECTIONS) {
    const here = live.filter((s) => !placed.has(s) && kinds.includes(s.kind));
    if (here.length === 0) continue;
    here.forEach((s) => placed.add(s));
    parts.push("", `## ${title}`, "", ...here.map(lineOf));
  }
  const rest = live.filter((s) => !placed.has(s));
  if (rest.length > 0) parts.push("", "## Also held", "", ...rest.map(lineOf));
  return parts.join("\n") + "\n";
}

export function renderCursorrules(doc: ExportDoc): string {
  const live = doc.statements.filter((s) => s.status === "active");
  return (
    [
      `# ${doc.space.name} — exported from memcell ${doc.space.exportedAt.slice(0, 10)}`,
      ...live.map((s) => lineOf(s).replace(/^- /, "")),
    ].join("\n") + "\n"
  );
}

export async function exportSpace(format: string, out?: string, url?: string): Promise<number> {
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
    say(
      row(0, [badge("memcell"), label("export")]),
      row(1, [warn(`no format called ${format}`)], [value(EXPORT_FORMATS.join(" · "))]),
    );
    return 1;
  }

  const here = await wired("export", url);
  if (!here) return 1;

  let doc: ExportDoc;
  try {
    doc = await call<ExportDoc>(
      here.instance,
      `/api/v1/spaces/${encodeURIComponent(here.space)}/export`,
      { method: "GET", bearer: here.key },
    );
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

  if (out) {
    await writeFile(out, rendered);
    say(
      row(0, [badge("memcell"), label("export"), place(here.space)]),
      row(1, [good(`${doc.statements.length} statements`)], [value(format)], [place(out)]),
    );
  } else {
    // The document itself, piped clean; the receipt rides beside it.
    emit(rendered);
    aside(
      row(0, [badge("memcell"), label("export"), place(here.space)]),
      row(1, [good(`${doc.statements.length} statements`)], [value(format)]),
    );
  }
  return 0;
}
