import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../src/commands/index.js";
import { enforceRequirements, resolveContext } from "../src/context.js";
import { saveCredential } from "../src/instance.js";
import { parse } from "../src/parse.js";
import { saveProject } from "../src/workspace.js";

async function scratch() {
  return mkdtemp(join(tmpdir(), "memcell-aspect-"));
}

describe("global flags parsing", () => {
  it("accepts --project and -p on commands that did not explicitly declare it", () => {
    const res = parse(["import", "--project", "my-project"], COMMANDS);
    expect(res.kind).toBe("run");
    if (res.kind === "run") {
      expect(res.flags.project).toBe("my-project");
    }

    const shortRes = parse(["import", "-p", "owner/short-proj"], COMMANDS);
    expect(shortRes.kind).toBe("run");
    if (shortRes.kind === "run") {
      expect(shortRes.flags.project).toBe("owner/short-proj");
    }
  });

  it("accepts --owner on commands without unknown flag errors", () => {
    const res = parse(["memories", "list", "--owner", "acme-corp"], COMMANDS);
    expect(res.kind).toBe("run");
    if (res.kind === "run") {
      expect(res.flags.owner).toBe("acme-corp");
    }
  });

  it("accepts --json across commands", () => {
    const res = parse(["export", "--json"], COMMANDS);
    expect(res.kind).toBe("run");
    if (res.kind === "run") {
      expect(res.flags.json).toBe(true);
    }
  });
});

describe("execution context resolution", () => {
  it("resolves project and owner from --project owner/slug flag", async () => {
    const context = await resolveContext("http://localhost:3000", {
      project: "acme/backend",
    });
    expect(context.project).not.toBeNull();
    expect(context.project?.owner).toBe("acme");
    expect(context.project?.project).toBe("backend");
    expect(context.project?.namespace).toBe("acme/backend");
    expect(context.project?.source).toBe("flag");
  });

  it("resolves project and owner when passed separately via flags", async () => {
    const context = await resolveContext("http://localhost:3000", {
      project: "frontend",
      owner: "design-org",
    });
    expect(context.project).not.toBeNull();
    expect(context.project?.owner).toBe("design-org");
    expect(context.project?.project).toBe("frontend");
    expect(context.project?.namespace).toBe("design-org/frontend");
    expect(context.project?.source).toBe("flag");
  });

  it("falls back to local .memcell project file when flags are absent", async () => {
    const dir = await scratch();
    await saveProject(
      {
        instance: "http://localhost:3000",
        owner: "team-alpha",
        project: "shared-core",
        space: "shared-core",
      },
      dir,
    );

    const context = await resolveContext("http://localhost:3000", {}, dir);
    expect(context.project).not.toBeNull();
    expect(context.project?.owner).toBe("team-alpha");
    expect(context.project?.project).toBe("shared-core");
    expect(context.project?.namespace).toBe("team-alpha/shared-core");
    expect(context.project?.source).toBe("file");
  });
});

describe("aspect requirement gates", () => {
  it("blocks execution when auth is required and user has no credential", () => {
    const mockCommand = {
      path: ["workspaces", "list"],
      what: "test",
      require: { auth: "required" as const },
      run: async () => 0,
    };

    const emptyContext = {
      instance: "http://localhost:3000",
      from: "/tmp",
      credential: null,
      project: null,
      owner: null,
    };

    const result = enforceRequirements(mockCommand, emptyContext);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.exitCode).toBe(1);
    }
  });

  it("blocks execution when project is required and no project can be resolved", () => {
    const mockCommand = {
      path: ["memories", "list"],
      what: "test",
      require: { project: "required" as const },
      run: async () => 0,
    };

    const unprojectedContext = {
      instance: "http://localhost:3000",
      from: "/tmp",
      credential: { token: "valid-token" },
      project: null,
      owner: null,
    };

    const result = enforceRequirements(mockCommand, unprojectedContext);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.exitCode).toBe(1);
    }
  });

  it("passes when all declared requirements are met", () => {
    const mockCommand = {
      path: ["memories", "list"],
      what: "test",
      require: { auth: "required" as const, project: "required" as const },
      run: async () => 0,
    };

    const validContext = {
      instance: "http://localhost:3000",
      from: "/tmp",
      credential: { token: "valid-token" },
      project: {
        owner: "test-owner",
        project: "test-proj",
        namespace: "test-owner/test-proj",
        source: "flag" as const,
      },
      owner: "test-owner",
    };

    const result = enforceRequirements(mockCommand, validContext);
    expect(result.ok).toBe(true);
  });
});
