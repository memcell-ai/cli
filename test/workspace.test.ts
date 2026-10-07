import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureGitignore,
  findProject,
  PROJECT_FILE,
  removeProject,
  saveProject,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_DIR,
  WORKSPACE_GITIGNORE,
} from "../src/workspace.js";

// What a wired directory is, pinned because getting it wrong is how the
// old `connect`/`disconnect` pair came to be inverses in name only.
//
// Two things carry the weight. The folder holds PROJECT TRUTH only — which
// memcell, which space — identical for every clone, which is what makes
// committing it a feature; identity (agent, key) is personal and lives in
// the machine keyring, so one teammate's connect never rewrites another's
// commit. And the folder is found by walking UP, because agents run from
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
    expect(found?.root).toBe(dir);
    const written = await readFile(at, "utf8");
    expect(written).not.toContain("[agent]");
    expect(written).not.toContain("[key]");

    // Verify .gitignore was created
    const gitignore = await readFile(join(dir, WORKSPACE_DIR, WORKSPACE_GITIGNORE), "utf8");
    expect(gitignore).toContain("!config.toml");
  });

  it("keeps the instance with the wiring, never as a separate setting", async () => {
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
    expect((await stat(at)).mode & 0o777).toBe(0o600);
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
    expect(found?.root).toBe(dir);
  });

  it("stops at the nearest one, so a nested project wins over its parent", async () => {
    const outer = await scratch();
    await saveProject(project, outer);
    const inner = join(outer, "packages", "worker");
    await mkdir(inner, { recursive: true });
    await saveProject({ ...project, space: "worker" }, inner);

    const found = await findProject(inner);
    expect(found?.project.space).toBe("worker");
    expect(found?.root).toBe(inner);
  });

  it("answers nothing rather than throwing where no wiring exists", async () => {
    expect(await findProject(await scratch())).toBeNull();
  });

  it("answers nothing rather than throwing on a file it cannot read", async () => {
    const dir = await scratch();
    const dotMemcell = join(dir, WORKSPACE_DIR);
    await mkdir(dotMemcell, { recursive: true });
    await writeFile(join(dotMemcell, WORKSPACE_CONFIG_FILE), "{ not toml");
    expect(await findProject(dir)).toBeNull();
  });
});

describe("unwiring", () => {
  it("removes the .memcell directory", async () => {
    const dir = await scratch();
    const at = await saveProject(project, dir);
    await removeProject(at);
    expect(await findProject(dir)).toBeNull();
  });

  it("is quiet about a directory that is already gone", async () => {
    const dir = await scratch();
    await expect(removeProject(join(dir, WORKSPACE_DIR))).resolves.toBeUndefined();
  });
});

describe("self-healing legacy project structures", () => {
  it("self-heals legacy single .memcell file into .memcell/ directory", async () => {
    const dir = await scratch();
    // Simulate legacy single file named `.memcell`
    const legacyFile = join(dir, ".memcell");
    await writeFile(
      legacyFile,
      `[instance]\nurl = "https://memcell.ai"\n\n[workspace]\nslug = "legacy-space"\n`,
      "utf8",
    );

    // Initial check: legacy file exists
    expect((await stat(legacyFile)).isFile()).toBe(true);

    // findProject triggers self-healing
    const found = await findProject(dir);
    expect(found).not.toBeNull();
    expect(found?.project.workspace).toBe("legacy-space");
    expect(found?.root).toBe(dir);
    expect(found?.at).toBe(join(dir, WORKSPACE_DIR, WORKSPACE_CONFIG_FILE));

    // Verify legacy file was replaced with directory
    const dirStat = await stat(join(dir, WORKSPACE_DIR));
    expect(dirStat.isDirectory()).toBe(true);

    // Verify config.toml and .gitignore exist in .memcell/
    const configContent = await readFile(join(dir, WORKSPACE_DIR, WORKSPACE_CONFIG_FILE), "utf8");
    expect(configContent).toContain('slug = "legacy-space"');
    const gitignoreContent = await readFile(join(dir, WORKSPACE_DIR, WORKSPACE_GITIGNORE), "utf8");
    expect(gitignoreContent).toContain("!config.toml");
  });

  it("self-heals legacy .memcell.toml file into .memcell/ directory", async () => {
    const dir = await scratch();
    // Simulate legacy single file named `.memcell.toml`
    const legacyFile = join(dir, ".memcell.toml");
    await writeFile(
      legacyFile,
      `[instance]\nurl = "https://memcell.ai"\n\n[project]\nslug = "aside-space"\n`,
      "utf8",
    );

    const found = await findProject(dir);
    expect(found?.project.project).toBe("aside-space");
    expect(found?.root).toBe(dir);

    // Verify .memcell.toml was removed and .memcell/config.toml exists
    const configContent = await readFile(join(dir, WORKSPACE_DIR, WORKSPACE_CONFIG_FILE), "utf8");
    expect(configContent).toContain('slug = "aside-space"');
    await expect(stat(legacyFile)).rejects.toThrow();
  });

  it("self-heals legacy file carrying older [agent] and [key] blocks", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, ".memcell"),
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
    const migrated = await readFile(found!.at, "utf8");
    expect(migrated).not.toContain("[agent]");
    expect(migrated).not.toContain("[key]");
  });

  it("writes and reads modern workspace table", async () => {
    const dir = await scratch();
    const at = await saveProject(
      { instance: "http://localhost:3100", workspace: "omega", space: "omega" },
      dir,
    );
    const text = await readFile(at, "utf8");
    expect(text).toContain("[workspace]");
    expect(text).toContain('slug = "omega"');
    expect(text).not.toContain("[project]");
    expect(text).not.toContain("[space]");

    const found = await findProject(dir);
    expect(found?.project.workspace).toBe("omega");
    expect(found?.project.space).toBe("omega");
  });

  it("automatically strips legacy [project] and [space] tables from config.toml", async () => {
    const dir = await scratch();
    const dotMemcellDir = join(dir, WORKSPACE_DIR);
    await mkdir(dotMemcellDir, { recursive: true });
    const configPath = join(dotMemcellDir, WORKSPACE_CONFIG_FILE);

    await writeFile(
      configPath,
      `[instance]\nurl = "http://localhost:3000"\n\n[workspace]\nslug = "sample"\n\n[project]\nslug = "sample"\n\n[space]\nslug = "sample"\n`,
      "utf8",
    );

    const found = await findProject(dir);
    expect(found?.project.workspace).toBe("sample");

    const cleaned = await readFile(configPath, "utf8");
    expect(cleaned).toContain("[workspace]");
    expect(cleaned).not.toContain("[project]");
    expect(cleaned).not.toContain("[space]");
  });

  it("recreates .gitignore inside .memcell if it was deleted", async () => {
    const dir = await scratch();
    await saveProject(project, dir);

    const gitignorePath = join(dir, WORKSPACE_DIR, WORKSPACE_GITIGNORE);
    expect(await stat(gitignorePath)).toBeDefined();

    // Delete .gitignore
    await rm(gitignorePath, { force: true });
    await expect(stat(gitignorePath)).rejects.toThrow();

    // When findProject inspects the workspace, it should automatically recreate .gitignore
    const found = await findProject(dir);
    expect(found).not.toBeNull();

    const restored = await readFile(gitignorePath, "utf8");
    expect(restored).toContain("!config.toml");
    expect(restored).toContain("!.gitignore");
  });

  it("creates .gitignore inside an empty .memcell directory when inspected", async () => {
    const dir = await scratch();
    const dotMemcellDir = join(dir, WORKSPACE_DIR);
    await mkdir(dotMemcellDir, { recursive: true });

    const gitignorePath = join(dotMemcellDir, WORKSPACE_GITIGNORE);
    await expect(stat(gitignorePath)).rejects.toThrow();

    await findProject(dir);

    const created = await readFile(gitignorePath, "utf8");
    expect(created).toContain("!config.toml");
  });

  it("repopulates .gitignore if it exists but is empty (0 bytes)", async () => {
    const dir = await scratch();
    const dotMemcellDir = join(dir, WORKSPACE_DIR);
    await mkdir(dotMemcellDir, { recursive: true });

    const gitignorePath = join(dotMemcellDir, WORKSPACE_GITIGNORE);
    await writeFile(gitignorePath, "", "utf8");
    expect((await stat(gitignorePath)).size).toBe(0);

    await ensureGitignore(dotMemcellDir);

    const populated = await readFile(gitignorePath, "utf8");
    expect(populated).toContain("!config.toml");
    expect(populated.length).toBeGreaterThan(0);
  });
});
