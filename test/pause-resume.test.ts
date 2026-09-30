import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findProject, PROJECT_FILE, saveProject, setProjectPaused } from "../src/project.js";
import { pause, resume } from "../src/commands/pause.js";
import { resolveProjectWiring } from "../src/loop/hook.js";

// Verifies that project pausing short-circuits hooks with zero overhead.

async function scratch() {
  return mkdtemp(join(tmpdir(), "memcell-pause-"));
}

describe("project pause & resume configuration", () => {
  it("serializes and deserializes paused = true in project file", async () => {
    const dir = await scratch();
    const at = await saveProject(
      {
        instance: "http://localhost:3100",
        space: "test-space",
        project: "test-space",
        paused: true,
      },
      dir,
    );

    const found = await findProject(dir);
    expect(found).not.toBeNull();
    expect(found?.project.paused).toBe(true);

    const raw = await readFile(at, "utf8");
    expect(raw).toContain("paused = true");
  });

  it("removes paused attribute when saved with paused = false", async () => {
    const dir = await scratch();
    await saveProject(
      {
        instance: "http://localhost:3100",
        space: "test-space",
        project: "test-space",
        paused: true,
      },
      dir,
    );

    const pausedFound = await findProject(dir);
    expect(pausedFound?.project.paused).toBe(true);

    const at = await saveProject(
      {
        ...pausedFound!.project,
        paused: false,
      },
      dir,
    );

    const resumedFound = await findProject(dir);
    expect(resumedFound?.project.paused).toBeUndefined();

    const raw = await readFile(at, "utf8");
    expect(raw).not.toContain("paused = true");
  });

  it("toggles pause state via setProjectPaused helper", async () => {
    const dir = await scratch();
    await saveProject(
      {
        instance: "http://localhost:3100",
        space: "test-space",
        project: "test-space",
      },
      dir,
    );

    const pausedRes = await setProjectPaused(true, dir);
    expect(pausedRes?.project.paused).toBe(true);

    const foundPaused = await findProject(dir);
    expect(foundPaused?.project.paused).toBe(true);

    const resumedRes = await setProjectPaused(false, dir);
    expect(resumedRes?.project.paused).toBe(false);

    const foundResumed = await findProject(dir);
    expect(foundResumed?.project.paused).toBeUndefined();
  });
});

describe("pause & resume commands", () => {
  it("returns error code 1 when not connected", async () => {
    const emptyDir = await scratch();
    const pauseCode = await pause(emptyDir);
    expect(pauseCode).toBe(1);

    const resumeCode = await resume(emptyDir);
    expect(resumeCode).toBe(1);
  });

  it("pauses and resumes connected project with exit code 0", async () => {
    const dir = await scratch();
    await saveProject(
      {
        instance: "http://localhost:3100",
        space: "test-space",
        project: "test-space",
      },
      dir,
    );

    // Initial pause
    const firstPause = await pause(dir);
    expect(firstPause).toBe(0);
    const afterFirstPause = await findProject(dir);
    expect(afterFirstPause?.project.paused).toBe(true);

    // Idempotent second pause
    const secondPause = await pause(dir);
    expect(secondPause).toBe(0);

    // Resume
    const firstResume = await resume(dir);
    expect(firstResume).toBe(0);
    const afterResume = await findProject(dir);
    expect(afterResume?.project.paused).toBeUndefined();

    // Idempotent second resume
    const secondResume = await resume(dir);
    expect(secondResume).toBe(0);
  });
});

describe("hook loop honoring paused state", () => {
  it("short-circuits resolveProjectWiring when paused", async () => {
    const dir = await scratch();
    await saveProject(
      {
        instance: "http://localhost:3100",
        space: "test-space",
        project: "test-space",
        paused: true,
      },
      dir,
    );

    const wiring = await resolveProjectWiring(dir);
    expect(wiring.ok).toBe(false);
    if (!wiring.ok) {
      expect(wiring.why).toBe("paused · run memcell resume");
      expect(wiring.project?.paused).toBe(true);
    }
  });
});
