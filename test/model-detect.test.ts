import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalDefaultModel,
  detectActiveRuntimeModel,
  detectAgentConfigModel,
  resolveModelForAgent,
} from "../src/model-detect.js";

describe("canonicalDefaultModel", () => {
  it("provides canonical defaults as a last resort for known agents", () => {
    expect(canonicalDefaultModel("claude")).toBe("claude-3-7-sonnet");
    expect(canonicalDefaultModel("antigravity")).toBe("gemini-2.5-pro");
    expect(canonicalDefaultModel("gemini")).toBe("gemini-2.5-pro");
    expect(canonicalDefaultModel("cursor")).toBe("claude-3-7-sonnet");
    expect(canonicalDefaultModel("copilot")).toBe("claude-3-7-sonnet");
    expect(canonicalDefaultModel("codex")).toBe("gpt-4o");
    expect(canonicalDefaultModel("opencode")).toBe("claude-3-7-sonnet");
    expect(canonicalDefaultModel("windsurf")).toBe("cascade");
  });

  it("handles case insensitivity and unknown agents cleanly", () => {
    expect(canonicalDefaultModel("CLAUDE")).toBe("claude-3-7-sonnet");
    expect(canonicalDefaultModel("unknown-agent")).toBe("claude-3-7-sonnet");
  });
});

describe("detectActiveRuntimeModel", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("prioritizes MEMCELL_MODEL when provided", () => {
    process.env.MEMCELL_MODEL = "custom-override-model";
    expect(detectActiveRuntimeModel("claude")).toBe("custom-override-model");
  });

  it("detects agent-specific runtime model environment variables", () => {
    delete process.env.MEMCELL_MODEL;

    process.env.CLAUDE_MODEL = "claude-3-5-haiku";
    expect(detectActiveRuntimeModel("claude")).toBe("claude-3-5-haiku");

    delete process.env.CLAUDE_MODEL;
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    expect(detectActiveRuntimeModel("gemini")).toBe("gemini-2.5-flash");

    delete process.env.GEMINI_MODEL;
    process.env.CURSOR_MODEL = "cursor-small";
    expect(detectActiveRuntimeModel("cursor")).toBe("cursor-small");

    delete process.env.CURSOR_MODEL;
    process.env.OPENCODE_MODEL = "opencode-deepseek";
    expect(detectActiveRuntimeModel("opencode")).toBe("opencode-deepseek");
  });

  it("returns undefined when no environment variable is present", () => {
    delete process.env.MEMCELL_MODEL;
    delete process.env.CLAUDE_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.MODEL;
    expect(detectActiveRuntimeModel("claude")).toBeUndefined();
  });
});

describe("detectAgentConfigModel", () => {
  it("reads model from project-local configuration files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-model-detect-"));
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-3-5-sonnet-20241022" }),
    );

    const detected = await detectAgentConfigModel("claude", dir);
    expect(detected).toBe("claude-3-5-sonnet-20241022");
  });

  it("reads model from opencode.json in project root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-model-detect-opencode-"));
    await writeFile(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek-coder-v2" }));

    const detected = await detectAgentConfigModel("opencode", dir);
    expect(detected).toBe("deepseek-coder-v2");
  });

  it("tolerates unreadable or missing config files without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-model-detect-empty-"));
    const detected = await detectAgentConfigModel("claude", dir);
    expect(detected).toBeUndefined();
  });
});

describe("resolveModelForAgent", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("resolves runtime telemetry over local config and defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-model-resolve-"));
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ model: "local-config-model" }),
    );

    process.env.MEMCELL_MODEL = "runtime-telemetry-model";
    const resolved = await resolveModelForAgent("claude", dir);
    expect(resolved).toBe("runtime-telemetry-model");
  });

  it("resolves local config over defaults when no runtime telemetry", async () => {
    delete process.env.MEMCELL_MODEL;
    delete process.env.CLAUDE_MODEL;

    const dir = await mkdtemp(join(tmpdir(), "memcell-model-resolve-"));
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ model: "local-config-model" }),
    );

    const resolved = await resolveModelForAgent("claude", dir);
    expect(resolved).toBe("local-config-model");
  });

  it("falls back to canonical default as last resort", async () => {
    delete process.env.MEMCELL_MODEL;
    delete process.env.CLAUDE_MODEL;

    const dir = await mkdtemp(join(tmpdir(), "memcell-model-empty-"));
    const resolved = await resolveModelForAgent("claude", dir);
    expect(resolved).toBe("claude-3-7-sonnet");
  });
});
