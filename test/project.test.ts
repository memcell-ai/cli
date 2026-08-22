import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findProject, PROJECT_FILE, removeProject, saveProject } from "../src/project.js";

// What a wired directory is, pinned because getting it wrong is how the
// old `connect`/`disconnect` pair came to be inverses in name only.
//
// Two things carry the weight. The file holds PROJECT TRUTH only — which
// memcell, which space — identical for every clone, which is what makes
// committing it a feature; identity (agent, key) is personal and lives in
// the machine keyring, so one teammate's connect never rewrites another's
// commit. And the file is found by walking UP, because agents run from
// wherever a task put them and a project that only answers from its own top
// directory is a project that is unwired half the time.

const project = {
  instance: "http://localhost:3100",
  space: "api",
};

async function scratch() {
  return mkdtemp(join(tmpdir(), "memcell-project-"));
}

describe("a wired directory", () => {
  it("records which memcell and which space, and nothing personal", async () => {
    const dir = await scratch();
    const at = await saveProject(project, dir);

    const found = await findProject(dir);
    expect(found?.project.space).toBe("api");
    const written = await readFile(at, "utf8");
    expect(written).not.toContain("[agent]");
    expect(written).not.toContain("[key]");
  });

  it("keeps the instance with the wiring, never as a separate setting", async () => {
    // A key minted against a laptop's dev server must never be presented
    // to the hosted one — which is only possible if the file says which
    // memcell it belongs to.
    const dir = await scratch();
    await saveProject(project, dir);
    expect((await findProject(dir))?.project.instance).toBe("http://localhost:3100");
  });

  it("never writes a key", async () => {
    const dir = await scratch();
    const at = await saveProject(project, dir);
    const written = await readFile(at, "utf8");
    expect(written).not.toContain("mc_");
  });

  it("is readable by the owner only", async () => {
    const dir = await scratch();
    const at = await saveProject(project, dir);
    const { stat } = await import("node:fs/promises");
    expect((await stat(at)).mode & 0o777).toBe(0o600);
  });

  it("still reads a file written before identity moved to the keyring", async () => {
    // An already-wired directory keeps working across the format change:
    // the extra [agent]/[key] tables are simply no longer read.
    const dir = await scratch();
    await writeFile(
      join(dir, PROJECT_FILE),
      [
        `[instance]`,
        `url = "http://localhost:3100"`,
        ``,
        `[space]`,
        `slug = "api"`,
        ``,
        `[agent]`,
        `id = "old-agent"`,
        ``,
        `[key]`,
        `id = "old-key"`,
      ].join("\n"),
    );
    const found = await findProject(dir);
    expect(found?.project.space).toBe("api");
  });
});

describe("finding it", () => {
  it("walks up, so an agent deep in a tree is still wired", async () => {
    const dir = await scratch();
    await saveProject(project, dir);
    const deep = join(dir, "src", "server", "handlers");
    await mkdir(deep, { recursive: true });

    const found = await findProject(deep);
    expect(found?.project.space).toBe("api");
    expect(found?.at).toBe(join(dir, PROJECT_FILE));
  });

  it("stops at the nearest one, so a nested project wins over its parent", async () => {
    const outer = await scratch();
    await saveProject(project, outer);
    const inner = join(outer, "packages", "worker");
    await mkdir(inner, { recursive: true });
    await saveProject({ ...project, space: "worker" }, inner);

    const found = await findProject(inner);
    expect(found?.project.space).toBe("worker");
  });

  it("answers nothing rather than throwing where no wiring exists", async () => {
    expect(await findProject(await scratch())).toBeNull();
  });

  it("answers nothing rather than throwing on a file it cannot read", async () => {
    // A half-written or hand-edited file is a directory that is not wired,
    // not a crashed command — every command calls this before doing
    // anything, so a throw here would break the ones that could still work.
    const dir = await scratch();
    await writeFile(join(dir, PROJECT_FILE), "{ not json");
    expect(await findProject(dir)).toBeNull();
  });
});

describe("unwiring", () => {
  it("removes the file", async () => {
    const dir = await scratch();
    const at = await saveProject(project, dir);
    await removeProject(at);
    expect(await findProject(dir)).toBeNull();
  });

  it("is quiet about a file that is already gone", async () => {
    const dir = await scratch();
    await expect(removeProject(join(dir, PROJECT_FILE))).resolves.toBeUndefined();
  });
});

describe("a directory wearing the project file's name", () => {
  it("saves beside it and finds it again — the embedded record's own dir", async () => {
    const { mkdtempSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { findProject, saveProject } = await import("../src/project.js");
    const dir = mkdtempSync(join(tmpdir(), "memcell-collide-"));
    // The single-process story: the record lives at .memcell/ in the project.
    mkdirSync(join(dir, ".memcell"));
    const at = await saveProject({ instance: "https://memcell.ai", space: "memcell" }, dir);
    expect(at.endsWith(".memcell.toml")).toBe(true);
    const found = await findProject(join(dir));
    expect(found?.project).toMatchObject({ instance: "https://memcell.ai", space: "memcell" });
  });

  it("the classic file name still wins where it exists", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { findProject, saveProject } = await import("../src/project.js");
    const dir = mkdtempSync(join(tmpdir(), "memcell-classic-"));
    const at = await saveProject({ instance: "https://memcell.ai", space: "one" }, dir);
    expect(at.endsWith("/.memcell")).toBe(true);
    expect((await findProject(dir))?.project.space).toBe("one");
  });
});
