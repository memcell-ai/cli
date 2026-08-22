import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { claude } from "../src/adapters/claude.js";
import { MCP_ARGS, MCP_COMMAND } from "../src/adapters/shared.js";
import { copilot } from "../src/adapters/copilot.js";
import { gemini } from "../src/adapters/gemini.js";

// Wiring a directory registers the MCP bridge beside the hooks — the same
// law: the committed entry is just `memcell mcp`, no secret anywhere, the
// key resolved at runtime from the machine keyring. Merge never clobbers
// somebody else's server; remove strips exactly ours.

const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));

describe("claude — .mcp.json at the project root", () => {
  it("installs the bridge, preserves foreign servers, removes only ours", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-mcp-claude-"));
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { theirs: { type: "http", url: "https://x/mcp" } } }),
    );

    await claude.install(dir);
    const doc = await read(join(dir, ".mcp.json"));
    expect(doc.mcpServers.memcell).toEqual({
      type: "stdio",
      command: MCP_COMMAND,
      args: MCP_ARGS,
    });
    expect(doc.mcpServers.theirs.url).toBe("https://x/mcp");

    await claude.remove(dir);
    const after = await read(join(dir, ".mcp.json"));
    expect(after.mcpServers.memcell).toBeUndefined();
    expect(after.mcpServers.theirs.url).toBe("https://x/mcp");
  });

  it("a file we created alone disappears on remove", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-mcp-claude2-"));
    await claude.install(dir);
    expect((await read(join(dir, ".mcp.json"))).mcpServers.memcell).toBeTruthy();
    await claude.remove(dir);
    await expect(readFile(join(dir, ".mcp.json"), "utf8")).rejects.toThrow();
  });

  it("an entry that is not the bridge command is never ours to remove", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-mcp-claude3-"));
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { memcell: { type: "http", url: "https://their-own/mcp" } } }),
    );
    await claude.remove(dir);
    expect((await read(join(dir, ".mcp.json"))).mcpServers.memcell.url).toBe(
      "https://their-own/mcp",
    );
  });
});

describe("gemini — mcpServers in .gemini/settings.json", () => {
  it("installs beside the hooks and removes with them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-mcp-gemini-"));
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await gemini.install(dir);
    const doc = await read(join(dir, ".gemini", "settings.json"));
    expect(doc.mcpServers.memcell).toEqual({ command: MCP_COMMAND, args: MCP_ARGS });

    await gemini.remove(dir);
    const after = await read(join(dir, ".gemini", "settings.json"));
    expect(after.mcpServers).toBeUndefined();
  });
});

describe("copilot — .github/mcp.json, a shared file", () => {
  it("merges into the shared file and strips only ours", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memcell-mcp-copilot-"));
    await mkdir(join(dir, ".github"), { recursive: true });
    await writeFile(
      join(dir, ".github", "mcp.json"),
      JSON.stringify({ mcpServers: { github: { type: "http", url: "https://gh/mcp" } } }),
    );

    await copilot.install(dir);
    const doc = await read(join(dir, ".github", "mcp.json"));
    expect(doc.mcpServers.memcell).toEqual({
      type: "local",
      command: MCP_COMMAND,
      args: MCP_ARGS,
      tools: ["*"],
    });
    expect(doc.mcpServers.github.url).toBe("https://gh/mcp");

    await copilot.remove(dir);
    const after = await read(join(dir, ".github", "mcp.json"));
    expect(after.mcpServers.memcell).toBeUndefined();
    expect(after.mcpServers.github.url).toBe("https://gh/mcp");
  });
});
