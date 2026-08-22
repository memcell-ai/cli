import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installSkill, removeSkill, verifySkill, SKILL_CONTENT } from "../src/adapters/skill.js";

// The shared skill drop: one file at the cross-agent reach point, teaching
// only doors that exist, leaving nothing behind on removal, and never
// taking anything that is not its own.

const scratch = () => mkdtempSync(join(tmpdir(), "memcell-skill-"));

describe("the drop and its undo", () => {
  it("installs, verifies current, and removes cleanly", async () => {
    const dir = scratch();
    const at = installSkill(dir);
    expect(at.endsWith(join(".agents", "skills", "memcell", "SKILL.md"))).toBe(true);
    expect(readFileSync(at, "utf8")).toBe(SKILL_CONTENT);
    expect(verifySkill(dir)).toEqual({ present: true, current: true });

    expect(await removeSkill(dir)).toBe(at);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
    expect(verifySkill(dir)).toEqual({ present: false, current: false });
    // Removing what is not there is a no-op, not an error.
    expect(await removeSkill(dir)).toBeNull();
  });

  it("reads a hand-edited drop as stale, and a refresh as safe", () => {
    const dir = scratch();
    const at = installSkill(dir);
    writeFileSync(at, "# edited by hand\n");
    expect(verifySkill(dir)).toEqual({ present: true, current: false });
    installSkill(dir);
    expect(verifySkill(dir).current).toBe(true);
  });

  it("leaves a sibling skill and its directories alone on removal", async () => {
    const dir = scratch();
    installSkill(dir);
    const sibling = join(dir, ".agents", "skills", "somebody-else");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "SKILL.md"), "# theirs\n");

    await removeSkill(dir);
    expect(existsSync(join(sibling, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "memcell"))).toBe(false);
  });
});

describe("what the skill is allowed to say", () => {
  it("has the frontmatter the reach point's convention needs", () => {
    expect(SKILL_CONTENT.startsWith("---\nname: memcell\ndescription: ")).toBe(true);
  });

  it("names only commands the registry declares", async () => {
    // Every `memcell <verb>` the skill teaches must be a verb the parser
    // answers to. A skill naming a command that does not exist sends an
    // agent to a shell error it cannot fix.
    const { COMMANDS } = await import("../src/commands/index.js");
    const declared = new Set(COMMANDS.map((c) => c.path[0]));
    const named = [...SKILL_CONTENT.matchAll(/memcell ([a-z-]+)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const verb of new Set(named)) {
      expect(declared, `the skill names \`memcell ${verb}\``).toContain(verb);
    }
  });

  it("teaches all four legs of the loop", () => {
    for (const leg of ["recall", "remember", "ingest", "report"]) {
      expect(SKILL_CONTENT).toContain(`memcell ${leg}`);
    }
  });

  it("works when nothing but the skill is installed", () => {
    // A skill can arrive alone — no MCP server, no wiring. It must name the
    // shell as a real path (not a dead end), and say what to do when the
    // directory has no memory at all, or it teaches calls into a void.
    expect(SKILL_CONTENT).toMatch(/\*\*The shell\*\*/);
    expect(SKILL_CONTENT).toContain("npx memcell");
    expect(SKILL_CONTENT).toContain("npx memcell connect");
    expect(SKILL_CONTENT).toMatch(/[Nn]ever invent a memory tool/);
  });

  it("teaches reinforcement, never dependence — the hooks stay the enforcement", () => {
    // The skill must SAY the deterministic loop already runs, so a model
    // that ignores everything else still knows nothing depends on it.
    expect(SKILL_CONTENT).toMatch(/[Hh]ooks already recall/);
  });

  it("is the same text the plugin ships", () => {
    // Two homes, one text: the string compiled into the package and the
    // file the plugin installs. Drift means two different instructions
    // under one name.
    const shipped = readFileSync(join(__dirname, "..", "plugins", "memcell", "SKILL.md"), "utf8");
    expect(SKILL_CONTENT, "run `pnpm run sync:skill` — the file and the string have drifted").toBe(
      shipped,
    );
  });
});
