import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  findGitRoot,
  findProject,
  findProjectFromRoots,
  PROJECT_FILE,
  PROJECT_FILE_ASIDE,
  saveProject,
} from "../src/project.js";
import {
  agentKeyForProject,
  listConnectedProjects,
  pruneProjectKeys,
  saveAgentKey,
} from "../src/keyring.js";

async function scratch() {
  return mkdtemp(join(tmpdir(), "memcell-lifecycle-"));
}

describe("project lifecycle & table preservation", () => {
  it("preserves existing [config] and custom TOML tables when updating project file", async () => {
    const dir = await scratch();
    const filePath = join(dir, PROJECT_FILE);

    // Seed file with existing config table and custom settings
    const initialToml = `
[instance]
url = "http://initial.test"

[project]
slug = "legacy-slug"

[config]
recall.limit = 10
auto_sync = true

[team_settings]
notifications = "disabled"
`;
    await writeFile(filePath, initialToml, { mode: 0o600 });

    // Update the project using saveProject targeting the file
    await saveProject(
      {
        instance: "http://updated.test",
        owner: "my-org",
        project: "new-slug",
        projectId: "proj_123",
        space: "new-slug",
      },
      filePath,
    );

    const content = await readFile(filePath, "utf8");
    expect(content).toContain('url = "http://updated.test"');
    expect(content).toContain('slug = "new-slug"');
    expect(content).toContain('id = "proj_123"');
    expect(content).toContain('owner = "my-org"');
    // Config and custom tables preserved!
    expect(content).toContain("auto_sync = true");
    expect(content).toContain("limit = 10");
    expect(content).toContain('notifications = "disabled"');
  });

  it("findGitRoot accurately detects git repo root and anchors project", async () => {
    const { realpath } = await import("node:fs/promises");
    const rootDir = await scratch();
    const subDir = join(rootDir, "packages", "core", "src");
    await mkdir(join(rootDir, ".git"), { recursive: true });
    await mkdir(subDir, { recursive: true });

    const detected = await findGitRoot(subDir);
    expect(await realpath(detected!)).toBe(await realpath(rootDir));

    // Saving project from a subfolder anchors to root when target is not specified
    const originalCwd = process.cwd();
    try {
      process.chdir(subDir);
      const savedPath = await saveProject({
        instance: "http://git.test",
        project: "git-proj",
        space: "git-proj",
      });
      expect(await realpath(savedPath)).toBe(await realpath(join(rootDir, PROJECT_FILE)));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("findProjectFromRoots resolves project from multiple candidate workspace roots", async () => {
    const dirA = await scratch();
    const dirB = await scratch();

    await saveProject(
      {
        instance: "http://roots.test",
        owner: "roots-org",
        project: "workspace-b",
        space: "workspace-b",
      },
      dirB,
    );

    const found = await findProjectFromRoots([dirA, dirB]);
    expect(found).not.toBeNull();
    expect(found?.project.project).toBe("workspace-b");
    expect(found?.project.owner).toBe("roots-org");
  });

  it("handles directory clashing by writing and reading .memcell.toml", async () => {
    const dir = await scratch();
    // Create .memcell as a DIRECTORY (e.g. embedded store)
    await mkdir(join(dir, PROJECT_FILE), { recursive: true });

    const savedPath = await saveProject(
      {
        instance: "http://aside.test",
        project: "aside-proj",
        space: "aside-proj",
      },
      dir,
    );

    expect(savedPath).toBe(join(dir, PROJECT_FILE_ASIDE));

    // findProject resolves aside
    const found = await findProject(dir);
    expect(found).not.toBeNull();
    expect(found?.at).toBe(join(dir, PROJECT_FILE_ASIDE));
    expect(found?.project.project).toBe("aside-proj");
  });
});

describe("multi-project keyring concurrency", () => {
  it("stores and lists multiple distinct projects without path collisions", async () => {
    const dir1 = await scratch();
    const dir2 = await scratch();

    await saveAgentKey({
      instance: "http://multi.test",
      keyId: "k1",
      key: "mc_key1",
      project: dir1,
      projectId: "p1",
      projectSlug: "proj-one",
      ownerSlug: "org-a",
      projectPath: dir1,
      agent: "antigravity",
    });

    await saveAgentKey({
      instance: "http://multi.test",
      keyId: "k2",
      key: "mc_key2",
      project: dir2,
      projectId: "p2",
      projectSlug: "proj-two",
      ownerSlug: "org-b",
      projectPath: dir2,
      agent: "antigravity",
    });

    const connected = await listConnectedProjects("http://multi.test");
    const slugs = connected.map((c) => c.projectSlug);
    expect(slugs).toContain("proj-one");
    expect(slugs).toContain("proj-two");

    // Keys resolved independently by project identifier or directory
    const key1 = await agentKeyForProject("http://multi.test", dir1, "antigravity", "p1");
    expect(key1?.keyId).toBe("k1");

    const key2 = await agentKeyForProject("http://multi.test", dir2, "antigravity", "p2");
    expect(key2?.keyId).toBe("k2");
  });
});
