import { dirname } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { agentKeyForProject } from "../keyring.js";
import { findProject } from "../project.js";
import { aside, badge, cmd, label, row, warn } from "../ui.js";

// `memcell mcp` — the stdio face of the paired instance's /mcp door.
//
// The config entry an agent client holds is just this command, and that is
// the point: the same law the hooks live by. A committed entry carries no
// secret — the key is read at runtime from the machine keyring, resolved
// from whichever wired directory the client launched in — so a teammate who
// clones gets the wiring and only needs their own pairing. The tools
// themselves are NOT defined here: this is a pipe to the instance's own MCP
// server, so what the model sees is exactly what the API says, defined once.
//
// stdout belongs to the protocol. Anything a person needs to read goes to
// stderr, where every MCP client surfaces it as server log output.

export async function mcp(targetDir?: string, agentName?: string): Promise<number> {
  // 1. Check specified targetDir if provided
  let found = targetDir ? await findProject(targetDir) : null;

  // 2. Check process.cwd()
  if (!found) {
    found = await findProject(process.cwd());
  }

  // 3. Check environment variables
  if (!found) {
    const envDir =
      process.env.MEMCELL_PROJECT_DIR ||
      process.env.WORKSPACE_DIR ||
      process.env.PROJECT_DIR ||
      process.env.VSCODE_WORKSPACE;
    if (envDir) {
      found = await findProject(envDir);
    }
  }

  // Strict project isolation: NEVER fall back to ~/.memcell/last-project or
  // keys from other repositories. If the current workspace has no .memcell,
  // we must never cross-contaminate or write to another space.
  if (!found) {
    const server = new Server(
      { name: "memcell", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "recall",
          description: "Recall project memory and guidelines. (Unconfigured workspace)",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
        {
          name: "remember",
          description: "Record durable project memory. (Unconfigured workspace)",
          inputSchema: { type: "object", properties: { change: { type: "string" } } },
        },
        {
          name: "report",
          description: "Report task outcome. (Unconfigured workspace)",
          inputSchema: { type: "object", properties: { outcome: { type: "string" } } },
        },
        {
          name: "ingest",
          description: "Ingest source materials. (Unconfigured workspace)",
          inputSchema: { type: "object", properties: { content: { type: "string" } } },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      isError: true,
      content: [
        {
          type: "text",
          text: `This workspace (${process.cwd()}) is not connected to memcell. Run 'memcell connect' in this project directory to wire memory for this project.`,
        },
      ],
    }));

    await server.connect(new StdioServerTransport());
    await new Promise<void>((resolve) => {
      server.onclose = () => resolve();
    });
    return 0;
  }

  const { project } = found;
  const held = await agentKeyForProject(project.instance, dirname(found.at), agentName);
  if (!held) {
    const server = new Server(
      { name: "memcell", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      isError: true,
      content: [
        {
          type: "text",
          text: `No agent key found on this machine for ${project.space}. Run 'memcell connect' in this project directory to pair this machine.`,
        },
      ],
    }));

    await server.connect(new StdioServerTransport());
    await new Promise<void>((resolve) => {
      server.onclose = () => resolve();
    });
    return 0;
  }

  const upstream = new Client({ name: "memcell-cli", version: "0.1.0" });
  await upstream.connect(
    new StreamableHTTPClientTransport(new URL(`${project.instance}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${held.key}`,
          ...(held.agentId ? { "x-memcell-agent": held.agentId } : {}),
        },
      },
    }),
  );

  const server = new Server({ name: "memcell", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    upstream.callTool(request.params),
  );

  await server.connect(new StdioServerTransport());
  // The transport owns the process from here: it serves until the client
  // closes stdin, and the promise below resolves only then.
  await new Promise<void>((resolve) => {
    server.onclose = () => resolve();
  });
  await upstream.close();
  return 0;
}
