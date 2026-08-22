import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { call, MemcellError } from "../client.js";
import {
  badge,
  bad,
  clearLine,
  good,
  label,
  pending,
  place,
  repaint,
  row,
  say,
  value,
  warn,
  type Row,
} from "../ui.js";
import { wired } from "./wired.js";

// `memcell import [files…]` — what this project already wrote down, handed
// to its memory. Run bare, it finds the instruction files agents already
// read — CLAUDE.md, AGENTS.md, .cursorrules, .cursor/rules, Copilot
// instructions — so a project that has been keeping notes starts remembering
// them without retyping anything.
//
// Every file goes through the real ingest door and gets distilled there:
// atomic statements with provenance, not a transcription. A JSON file is
// read for its text first — a top-level array, or one under a plainly named
// key, of strings or of objects that carry their text in a string field.
// That shape is generic on purpose: it reads our own export back, and it
// reads any export that says what it means, without hard-coding anybody
// else's format.

/** Where projects already keep their standing instructions. */
export const KNOWN_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];
const KNOWN_DIRS: { dir: string; ext: string }[] = [{ dir: ".cursor/rules", ext: ".mdc" }];

interface Kept {
  created: { statementId: string }[];
  reinforced: { statementId: string }[];
  note?: string;
}

/** The text inside a JSON export, if the shape says where it is. */
export function textsFromJson(parsed: unknown): string[] | null {
  const arrayOf = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const key of ["statements", "memories", "items", "results", "entries"]) {
        const inner = (v as Record<string, unknown>)[key];
        if (Array.isArray(inner)) return inner;
      }
    }
    return null;
  };
  const entries = arrayOf(parsed);
  if (!entries) return null;
  const texts: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (entry.trim()) texts.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object") {
      for (const key of ["text", "memory", "content", "statement"]) {
        const held = (entry as Record<string, unknown>)[key];
        if (typeof held === "string" && held.trim()) {
          texts.push(held.trim());
          break;
        }
      }
    }
  }
  return texts.length > 0 ? texts : null;
}

/** What one file delivers: its text, or the text its JSON carries. */
export function deliveryOf(name: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const texts = textsFromJson(JSON.parse(trimmed));
      if (texts) return texts.join("\n");
      if (name.endsWith(".json")) return null; // JSON with no text in it
    } catch {
      // Not JSON after all — it goes in as the text it is.
    }
  }
  return trimmed ? trimmed : null;
}

/** The instruction files this directory actually has. */
export async function discover(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of KNOWN_FILES) {
    try {
      await readFile(join(root, name), "utf8");
      found.push(join(root, name));
    } catch {
      // Absent — most of them will be.
    }
  }
  for (const { dir, ext } of KNOWN_DIRS) {
    try {
      const names = await readdir(join(root, dir));
      for (const name of names.sort()) {
        if (name.endsWith(ext)) found.push(join(root, dir, name));
      }
    } catch {
      // No such directory.
    }
  }
  return found;
}

export async function importFiles(files: string[]): Promise<number> {
  const here = await wired("import");
  if (!here) return 1;
  const root = here.root;

  const chosen = files.length > 0 ? files : await discover(root);
  if (chosen.length === 0) {
    say(
      row(0, [badge("memcell"), label("import"), place(here.space)]),
      row(1, [warn("nothing to import")], [label("looked for"), value(KNOWN_FILES.join(" · "))]),
    );
    return 1;
  }

  // One block at the end, in the statusline voice; while a file distills,
  // a live line breathes so a slow model pass does not read as a hang.
  const rows: Row[] = [row(0, [badge("memcell"), label("import"), place(here.space)])];
  let landed = 0;
  let created = 0;
  let reinforced = 0;
  for (const file of chosen) {
    const shown = relative(process.cwd(), file) || file;
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      rows.push(row(1, [bad("cannot read")], [place(shown)]));
      continue;
    }
    const delivery = deliveryOf(file, raw);
    if (delivery === null) {
      rows.push(row(1, [warn("no text found")], [place(shown)]));
      continue;
    }
    let tick = 0;
    const breathe = setInterval(
      () =>
        repaint(
          row(0, [label("distilling"), place(shown)], [{ k: "text", t: pending(14, tick++) }]),
        ),
      120,
    );
    try {
      const kept = await call<Kept>(
        here.instance,
        `/api/v1/spaces/${encodeURIComponent(here.space)}/ingest`,
        { method: "POST", bearer: here.key, body: { raw: delivery, origin: { title: shown } } },
      );
      landed += 1;
      created += kept.created.length;
      reinforced += kept.reinforced.length;
      rows.push(
        row(
          1,
          [good(shown)],
          [label("kept"), value(String(kept.created.length))],
          kept.reinforced.length > 0
            ? [label("reinforced"), value(String(kept.reinforced.length))]
            : null,
        ),
      );
    } catch (error) {
      if (!(error instanceof MemcellError)) throw error;
      rows.push(row(1, [bad("refused")], [place(shown)], [label(error.message)]));
    } finally {
      clearInterval(breathe);
      clearLine();
    }
  }

  rows.push(
    row(
      1,
      landed > 0 ? [good(`${landed} of ${chosen.length} files`)] : [bad("nothing landed")],
      [label("kept"), value(String(created))],
      reinforced > 0 ? [label("reinforced"), value(String(reinforced))] : null,
    ),
  );
  say(...rows);
  return landed > 0 ? 0 : 1;
}
