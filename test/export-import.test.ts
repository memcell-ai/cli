import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderCursorrules, renderMarkdown } from "../src/commands/export.js";
import { deliveryOf, discover, textsFromJson } from "../src/commands/import.js";

// Import and export are the promise that memory is the user's to carry:
// what a project already wrote down goes in without retyping, and what the
// agents learned comes out as the files other agents already read. The
// renderers and the sniffing are pure, so they are pinned here directly;
// the doors they talk through have their own suites.

const doc = {
  space: { slug: "payments", name: "payments", exportedAt: "2026-08-21T00:00:00.000Z" },
  statements: [
    {
      text: "Retries cap at five attempts.",
      kind: "convention",
      scope: "team",
      status: "active",
      confidence: 0.7,
      context: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      evidence: [],
    },
    {
      text: "The gateway keeps idempotency keys for a day.",
      kind: "fact",
      scope: "team",
      status: "active",
      confidence: 0.6,
      context: { when: "talking to the payment gateway" },
      createdAt: "2026-08-02T00:00:00.000Z",
      evidence: [],
    },
    {
      text: "Batch refunds through the ledger job.",
      kind: "decision",
      scope: "team",
      status: "active",
      confidence: 0.8,
      context: null,
      createdAt: "2026-08-03T00:00:00.000Z",
      evidence: [],
    },
    {
      text: "Polling the gateway for capture status times out under load.",
      kind: "dead_end",
      scope: "team",
      status: "active",
      confidence: 0.75,
      context: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      evidence: [],
    },
    {
      text: "Refunds used to route through the old worker.",
      kind: "fact",
      scope: "team",
      status: "retired",
      confidence: 0.2,
      context: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      evidence: [],
    },
  ],
};

describe("the markdown renderers", () => {
  it("groups by kind in reading order, and only what is active", () => {
    const md = renderMarkdown(doc, "Project memory");
    const at = (needle: string) => md.indexOf(needle);
    expect(at("## Decisions")).toBeGreaterThan(-1);
    expect(at("## Decisions")).toBeLessThan(at("## Conventions"));
    expect(at("## Conventions")).toBeLessThan(at("## Dead ends — do not retry"));
    expect(at("## Dead ends — do not retry")).toBeLessThan(at("## Facts"));
    expect(md).toContain("Batch refunds through the ledger job.");
    expect(md).not.toContain("the old worker");
    expect(md).toContain("4 statements");
  });

  it("carries a statement's condition beside its claim", () => {
    const md = renderMarkdown(doc, "Project memory");
    expect(md).toContain(
      "The gateway keeps idempotency keys for a day. *(applies when talking to the payment gateway)*",
    );
  });

  it("cursorrules is the flat form of the same statements", () => {
    const rules = renderCursorrules(doc);
    expect(rules).toContain("Retries cap at five attempts.");
    expect(rules).not.toContain("## ");
    expect(rules).not.toContain("the old worker");
  });
});

describe("reading text out of a JSON export", () => {
  it("takes a top-level array of strings", () => {
    expect(textsFromJson(["one", " two ", ""])).toEqual(["one", "two"]);
  });

  it("takes objects that say where their text is", () => {
    expect(
      textsFromJson([{ text: "a" }, { memory: "b" }, { content: "c" }, { statement: "d" }]),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("looks under the plainly named wrapper keys", () => {
    expect(textsFromJson({ memories: [{ memory: "kept" }] })).toEqual(["kept"]);
    expect(textsFromJson({ statements: ["kept"] })).toEqual(["kept"]);
  });

  it("reads our own export back — the round trip", () => {
    expect(textsFromJson(doc)).toEqual(doc.statements.map((s) => s.text));
  });

  it("answers null when the shape says nothing", () => {
    expect(textsFromJson({ nested: { deep: true } })).toBeNull();
    expect(textsFromJson([{ id: 4 }])).toBeNull();
    expect(textsFromJson("just a string")).toBeNull();
  });
});

describe("what one file delivers", () => {
  it("markdown goes in as it is", () => {
    expect(deliveryOf("CLAUDE.md", "# Rules\nBe brief.\n")).toBe("# Rules\nBe brief.");
  });

  it("a JSON file with no text in it delivers nothing", () => {
    expect(deliveryOf("export.json", '{"version": 2}')).toBeNull();
  });

  it("a brace that is not JSON is still text", () => {
    expect(deliveryOf("notes.md", "{caveat} braces are fine in prose")).toBe(
      "{caveat} braces are fine in prose",
    );
  });
});

describe("finding the instruction files a project already keeps", () => {
  it("finds the known names and the cursor rules directory, nothing else", async () => {
    const root = await mkdtemp(join(tmpdir(), "memcell-import-"));
    await writeFile(join(root, "CLAUDE.md"), "# rules");
    await writeFile(join(root, ".cursorrules"), "rules");
    await writeFile(join(root, "README.md"), "not instructions");
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(join(root, ".cursor", "rules", "b.mdc"), "b");
    await writeFile(join(root, ".cursor", "rules", "a.mdc"), "a");
    await writeFile(join(root, ".cursor", "rules", "note.txt"), "not a rule");

    const found = await discover(root);
    expect(found).toEqual([
      join(root, "CLAUDE.md"),
      join(root, ".cursorrules"),
      join(root, ".cursor", "rules", "a.mdc"),
      join(root, ".cursor", "rules", "b.mdc"),
    ]);
  });
});
