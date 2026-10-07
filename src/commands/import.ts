import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { MemCellError } from "@memcell/sdk";

import { MemcellError } from "../client.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  clearLine,
  emit,
  good,
  label,
  pending,
  place,
  repaint,
  row,
  say,
  value,
  variant,
  warn,
  type Row,
} from "../ui.js";
import { wired } from "./wired.js";

// `memcell import [files…]` — what this project already established or wrote
// down, handed to its institutional memory. Run bare, it automatically finds
// the standing guidance and instruction files agents read — CLAUDE.md, AGENTS.md,
// GEMINI.md, .cursorrules, .cursor/rules, .windsurfrules, Copilot instructions —
// so a project with notes starts remembering them without retyping anything.
//
// Every file goes through the server's distillation engine and gets turned into
// atomic memories with provenance. A JSON file is read for its text first —
// a top-level array, or one under a plainly named key, of strings or of objects
// that carry their text in a string field. That shape is generic on purpose:
// it reads our own export back, and it reads any export that says what it means,
// without hard-coding external formats.

/** Standing guidance files checked in bare discovery. */
export const KNOWN_FILES = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "GEMINI.md",
  "AGY.md",
  ".windsurfrules",
  ".clinerules",
  ".claude/CLAUDE.md",
  ".gemini/GEMINI.md",
  ".agents/instructions.md",
  ".codex/instructions.md",
  ".goosehints",
];

export const KNOWN_DIRS: { dir: string; ext: string }[] = [
  { dir: ".cursor/rules", ext: ".mdc" },
  { dir: ".cursor/rules", ext: ".md" },
  { dir: ".claude/rules", ext: ".md" },
  { dir: ".windsurf/rules", ext: ".md" },
  { dir: ".clinerules", ext: ".md" },
  { dir: ".agents", ext: ".md" },
];

export interface ImportOptions {
  files?: string[];
  url?: string;
  workspace?: string;
  project?: string;
  owner?: string;
  dryRun?: boolean;
  scope?: string;
  type?: string;
  json?: boolean;
}

export interface ImportResultFile {
  file: string;
  status: "kept" | "unreadable" | "empty" | "refused" | "preview";
  created?: number;
  reinforced?: number;
  chars?: number;
  error?: string;
}

export interface ImportResultSummary {
  ok: boolean;
  space?: string;
  dryRun: boolean;
  files: ImportResultFile[];
  totalCreated: number;
  totalReinforced: number;
}

/** The text inside a JSON export, if the shape says where it is. */
export function textsFromJson(parsed: unknown): string[] | null {
  const arrayOf = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const key of ["memories", "items", "results", "entries"]) {
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
      for (const key of ["text", "memory", "content", "title"]) {
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

/** The guidance files this directory actually contains. */
export async function discover(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of KNOWN_FILES) {
    try {
      const stats = await stat(join(root, name));
      if (stats.isFile()) {
        const fullPath = join(root, name);
        if (!found.includes(fullPath)) found.push(fullPath);
      }
    } catch {
      // Absent or not a file
    }
  }
  for (const { dir, ext } of KNOWN_DIRS) {
    try {
      const names = await readdir(join(root, dir));
      for (const name of names.sort()) {
        if (name.endsWith(ext)) {
          const fullPath = join(root, dir, name);
          try {
            const stats = await stat(fullPath);
            if (stats.isFile() && !found.includes(fullPath)) {
              found.push(fullPath);
            }
          } catch {
            // Inaccessible
          }
        }
      }
    } catch {
      // No such directory
    }
  }
  return found;
}

export async function importFiles(
  filesOrOptions: string[] | ImportOptions,
  legacyUrl?: string,
): Promise<number> {
  const options: ImportOptions = Array.isArray(filesOrOptions)
    ? { files: filesOrOptions, url: legacyUrl }
    : filesOrOptions;

  const explicitWorkspace = options.workspace || options.project;
  const hasWorkspace = Boolean(explicitWorkspace);
  const here = await wired("import", options.url, { silent: hasWorkspace });

  let targetSpace: string;
  let root: string;
  let targetInstance = options.url ?? "http://localhost:3000";
  let targetBearer: string | undefined;

  if (here) {
    targetSpace = here.space;
    root = here.root;
    targetInstance = here.instance;
    targetBearer = here.key;
  } else if (explicitWorkspace) {
    targetSpace = explicitWorkspace;
    root = process.cwd();
  } else {
    return 1;
  }

  const chosen = options.files && options.files.length > 0 ? options.files : await discover(root);
  if (chosen.length === 0) {
    if (options.json) {
      emit(
        JSON.stringify(
          {
            ok: false,
            space: targetSpace,
            dryRun: Boolean(options.dryRun),
            files: [],
            totalCreated: 0,
            totalReinforced: 0,
            message: "nothing to import",
            lookedFor: KNOWN_FILES,
          },
          null,
          2,
        ) + "\n",
      );
      return 1;
    }
    say(
      row(0, [badge("memcell"), label("import"), place(targetSpace)]),
      row(
        1,
        [warn("nothing to import")],
        [label("looked for"), value(KNOWN_FILES.slice(0, 4).join(" · ") + " …")],
      ),
    );
    return 1;
  }

  const rows: Row[] = [row(0, [badge("memcell"), label("import"), place(targetSpace)])];
  const summaryFiles: ImportResultFile[] = [];
  let landed = 0;
  let created = 0;
  let reinforced = 0;

  for (const file of chosen) {
    const shown = (relative(process.cwd(), file) || file).replace(/\\/g, "/");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      summaryFiles.push({ file: shown, status: "unreadable", error: "cannot read file" });
      rows.push(row(1, [bad("cannot read")], [place(shown)]));
      continue;
    }

    const delivery = deliveryOf(file, raw);
    if (delivery === null) {
      summaryFiles.push({ file: shown, status: "empty", error: "no text found" });
      rows.push(row(1, [warn("no text found")], [place(shown)]));
      continue;
    }

    if (options.dryRun) {
      landed += 1;
      summaryFiles.push({
        file: shown,
        status: "preview",
        chars: delivery.length,
      });
      rows.push(
        row(
          1,
          [variant(shown)],
          [label("preview"), value(`${delivery.length} chars`)],
          options.type ? [label("type"), value(options.type)] : null,
          options.scope ? [label("scope"), value(options.scope)] : null,
        ),
      );
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
      const sdk = await getSdkClient(targetInstance, targetBearer ? { bearer: targetBearer } : {});
      const kept = await sdk.remember({
        namespace: targetSpace,
        title: shown,
        raw: delivery,
        type: options.type as any,
        scope: options.scope,
        metadata: {
          origin: { title: shown, path: shown },
        },
      });

      const createdCount = kept.created ? kept.created.length : 0;
      const reinforcedCount = Array.isArray(kept.reinforced) ? kept.reinforced.length : 0;

      landed += 1;
      created += createdCount;
      reinforced += reinforcedCount;

      summaryFiles.push({
        file: shown,
        status: "kept",
        created: createdCount,
        reinforced: reinforcedCount,
      });

      rows.push(
        row(
          1,
          [good(shown)],
          [label("kept"), value(String(createdCount))],
          reinforcedCount > 0 ? [label("reinforced"), value(String(reinforcedCount))] : null,
          options.type ? [label("type"), value(options.type)] : null,
          options.scope ? [label("scope"), value(options.scope)] : null,
        ),
      );
    } catch (error) {
      const message =
        error instanceof MemcellError || error instanceof MemCellError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      summaryFiles.push({ file: shown, status: "refused", error: message });
      rows.push(row(1, [bad("refused")], [place(shown)], [label(message)]));
    } finally {
      clearInterval(breathe);
      clearLine();
    }
  }

  if (options.json) {
    const summary: ImportResultSummary = {
      ok: landed > 0,
      space: targetSpace,
      dryRun: Boolean(options.dryRun),
      files: summaryFiles,
      totalCreated: created,
      totalReinforced: reinforced,
    };
    emit(JSON.stringify(summary, null, 2) + "\n");
    return landed > 0 ? 0 : 1;
  }

  if (options.dryRun) {
    rows.push(
      row(
        1,
        [good(`${landed} of ${chosen.length} files previewed`)],
        [label("dry run"), value("no memory written")],
      ),
    );
  } else {
    rows.push(
      row(
        1,
        landed > 0 ? [good(`${landed} of ${chosen.length} files`)] : [bad("nothing landed")],
        [label("kept"), value(String(created))],
        reinforced > 0 ? [label("reinforced"), value(String(reinforced))] : null,
      ),
    );
  }

  say(...rows);
  return landed > 0 ? 0 : 1;
}
