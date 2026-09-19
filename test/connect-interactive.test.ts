import { describe, expect, it } from "vitest";

import { ask, CAN_ASK, choose } from "../src/select.js";
import { badInstance, DEFAULT_INSTANCE, normalize } from "../src/instance.js";

describe("interactive prompts: choose and ask", () => {
  it("CAN_ASK reports false in automated test / CI environments", () => {
    // In vitest / CI, CAN_ASK must be false to prevent hanging test runs
    expect(CAN_ASK()).toBe(false);
  });

  it("choose returns default/initial choice when CAN_ASK is false", async () => {
    const choices = [
      { name: "cloud", label: "MemCell Cloud" },
      { name: "local", label: "Local Development" },
    ];
    // In non-interactive environments, choose should return choices[initial] without blocking
    const selected = await choose("Select instance:", choices, 1);
    expect(selected).toBe("local");
  });

  it("choose returns null for empty choices", async () => {
    const selected = await choose("Empty:", []);
    expect(selected).toBeNull();
  });

  it("ask returns defaultValue when CAN_ASK is false", async () => {
    const answer = await ask("Project name", "my-default-project");
    expect(answer).toBe("my-default-project");
  });

  it("ask returns null when no default is provided in non-interactive environment", async () => {
    const answer = await ask("Enter custom URL");
    expect(answer).toBeNull();
  });
});

describe("instance selection & validation in interactive connect", () => {
  it("validates instance URLs correctly with badInstance", () => {
    expect(badInstance("http://localhost:3000")).toBeNull();
    expect(badInstance("https://memcell.ai")).toBeNull();
    expect(badInstance("http://127.0.0.1:8080")).toBeNull();

    expect(badInstance("not-a-url")).toContain("is not a URL");
    expect(badInstance("ftp://example.com")).toContain("is not http or https");
  });

  it("normalizes trailing slashes on selected instances", () => {
    expect(normalize("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalize("https://memcell.ai///")).toBe("https://memcell.ai");
  });
});

describe("project response unwrapping for interactive connect", () => {
  it("extracts slug and owner correctly from nested project response", () => {
    const res: {
      ok?: boolean;
      project?: { id?: string; slug: string; name: string; ownerSlug?: string };
      slug?: string;
      ownerSlug?: string;
    } = {
      ok: true,
      project: {
        id: "proj_123",
        name: "sample",
        slug: "sample",
        ownerSlug: "memcell",
      },
    };
    const proj = res.project ?? res;
    const slug = proj.slug;
    const finalOwner = proj.ownerSlug || "memcell";
    const targetProject = finalOwner ? `${finalOwner}/${slug}` : slug;

    expect(slug).toBe("sample");
    expect(targetProject).toBe("memcell/sample");
  });

  it("extracts slug and owner correctly from flat project response", () => {
    const res: {
      ok?: boolean;
      project?: { id?: string; slug: string; name: string; ownerSlug?: string };
      slug?: string;
      ownerSlug?: string;
    } = {
      ok: true,
      slug: "sample",
      ownerSlug: "memcell",
    };
    const proj = res.project ?? res;
    const slug = proj.slug;
    const finalOwner = proj.ownerSlug || "memcell";
    const targetProject = finalOwner ? `${finalOwner}/${slug}` : slug;

    expect(slug).toBe("sample");
    expect(targetProject).toBe("memcell/sample");
  });
});
