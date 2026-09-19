import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findProjectFromRoots, saveProject } from "../src/project.js";
import { listConnectedProjects, saveAgentKey } from "../src/keyring.js";

async function scratch() {
  return mkdtemp(join(tmpdir(), "memcell-mcp-dyn-"));
}

describe("mcp dynamic project resolution", () => {
  it("resolves project when one of the roots matches a connected directory", async () => {
    const rootA = await scratch();
    const rootB = await scratch();
    const rootC = await scratch();

    await saveProject(
      {
        instance: "http://dynamic-roots.test",
        owner: "org-mcp",
        project: "proj-mcp-b",
        space: "proj-mcp-b",
      },
      rootB,
    );

    const found = await findProjectFromRoots([rootA, rootB, rootC]);
    expect(found).not.toBeNull();
    expect(found?.project.project).toBe("proj-mcp-b");
    expect(found?.project.owner).toBe("org-mcp");
  });

  it("identifies single connected project when outside workspace roots", async () => {
    const projectDir = await scratch();
    await saveAgentKey({
      instance: "http://single-mcp.test",
      keyId: "k_single",
      key: "mc_single",
      project: projectDir,
      projectId: "proj_single_123",
      projectSlug: "single-project",
      ownerSlug: "single-org",
      projectPath: projectDir,
      agent: "antigravity",
    });

    const connected = await listConnectedProjects("http://single-mcp.test");
    expect(connected).toHaveLength(1);
    expect(connected[0]?.projectId).toBe("proj_single_123");
    expect(connected[0]?.projectSlug).toBe("single-project");
    expect(connected[0]?.ownerSlug).toBe("single-org");
  });
});
