import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/commands/index.js";
import { detail, overview, refusal } from "../src/help.js";
import { parse } from "../src/parse.js";

describe("command help and incomplete invocations", () => {
  it("renders detail for every known command without throwing", () => {
    for (const cmd of COMMANDS) {
      expect(() => detail(cmd.path[0]!)).not.toThrow();
      expect(() => detail(cmd.path.join(" "))).not.toThrow();
    }
  });

  it("renders refusal with command-specific help when required args are missing", () => {
    const starParsed = parse(["memories", "star"], COMMANDS);
    expect(starParsed.kind).toBe("error");
    if (starParsed.kind === "error") {
      expect(starParsed.message).toContain("memories star needs <id>");
      const rendered = refusal(starParsed.message, starParsed.hint);
      expect(rendered).toContain("memories star needs <id>");
      expect(rendered).toContain("memcell memories star <id>");
      expect(rendered).toContain("--workspace");
    }

    const updateParsed = parse(["memories", "update"], COMMANDS);
    expect(updateParsed.kind).toBe("error");
    if (updateParsed.kind === "error") {
      expect(updateParsed.message).toContain("memories update needs <id>");
      const rendered = refusal(updateParsed.message, updateParsed.hint);
      expect(rendered).toContain("memories update needs <id>");
      expect(rendered).toContain("memcell memories update <id>");
      expect(rendered).toContain("--text");
    }
  });

  it("falls back cleanly to overview for unknown topics", () => {
    expect(() => detail("nonexistent-topic")).not.toThrow();
    expect(detail("nonexistent-topic")).toBe(overview());
  });
});
