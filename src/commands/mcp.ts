import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { agentKeyForProject, listConnectedProjects } from "../keyring.js";
import { detectActiveRuntimeModel } from "../model-detect.js";
import { findProject, findProjectFromRoots, type Project } from "../project.js";

// `memcell mcp` — the stdio face of the paired instance's /mcp endpoint.
//
// Bridges IDEs and autonomous agent harnesses to MemCell over standard MCP stdio.
// Dynamically resolves workspace projects via MCP client roots (roots/list),
// CLI target directory, process.cwd(), or keyring-connected projects.
// Maintains upstream HTTP client pooling per connected project/instance.

const DEFAULT_TOOLS = [
  {
    name: "recall",
    description:
      "Ask the project's memory before acting. Evaluates intent against durable invariants and conventions. Zero conversation retention: query text is strictly ephemeral and never stored. Pass the recallId to 'report' so task outcomes sharpen what was recalled.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "What you are trying to do or know, in plain words",
        },
        query: {
          type: "string",
          description: "Alternative alias for intent",
        },
        limit: {
          type: "number",
          description: "How many matched statements to serve (default 5, max 20)",
        },
        type: {
          type: "string",
          description:
            "Optional statement type filter: directive, fact, preference, or observation",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags to filter or guide lexical matching",
        },
      },
    },
  },
  {
    name: "remember",
    description:
      "Form durable memory. Distills durable knowledge, conventions, and directives through the zero-trust pipeline. If the change contradicts an existing statement, the memory engine resolves it.",
    inputSchema: {
      type: "object",
      properties: {
        learning: {
          type: "string",
          description: "The concrete knowledge, invariant, preference, or convention to persist",
        },
        change: {
          type: "string",
          description: "Alternative alias for learning",
        },
        type: {
          type: "string",
          description: "Statement type: directive, fact, preference, or observation",
        },
        title: {
          type: "string",
          description: "Optional concise title",
        },
        context: {
          type: "string",
          description: "Why this was learned: the task, trigger, or surrounding circumstance",
        },
      },
    },
  },
  {
    name: "report",
    description:
      "Close the recall loop. Reports whether a recalled statement worked, failed, or was avoided in practice. Strengthens what worked and surfaces what failed for correction.",
    inputSchema: {
      type: "object",
      properties: {
        recallId: {
          type: "string",
          description: "The recallId returned by the prior recall call",
        },
        outcome: {
          type: "string",
          enum: ["worked", "failed", "avoided"],
          description: "What happened when this memory was applied",
        },
        details: {
          type: "string",
          description: "Optional explanation of the outcome or what happened",
        },
      },
      required: ["outcome"],
    },
  },
];

export async function mcp(targetDir?: string, agentName?: string): Promise<number> {
  const server = new Server(
    { name: "memcell", version: "0.3.0" },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const upstreamPool = new Map<string, Client>();

  async function resolveCurrentProject(
    workspaceHint?: string,
  ): Promise<{ project: Project; at: string } | null> {
    // 1. Explicit workspace hint passed to tool call
    if (workspaceHint) {
      const found = await findProject(workspaceHint).catch(() => null);
      if (found) return found;
    }

    // 2. Explicit targetDir passed via CLI argument
    if (targetDir) {
      const found = await findProject(targetDir).catch(() => null);
      if (found) return found;
    }

    // 3. MCP roots protocol list from the IDE / client
    try {
      const rootsResult = await server.listRoots();
      if (rootsResult?.roots?.length) {
        const rootPaths = rootsResult.roots.map((r) =>
          r.uri.startsWith("file://") ? fileURLToPath(r.uri) : r.uri,
        );
        const found = await findProjectFromRoots(rootPaths);
        if (found) return found;
      }
    } catch {
      // Client does not implement roots or hasn't connected roots capability
    }

    // 4. Check process.cwd()
    const foundCwd = await findProject(process.cwd()).catch(() => null);
    if (foundCwd) return foundCwd;

    // 5. Check workspace environment variables
    const envDir =
      process.env.MEMCELL_PROJECT_DIR ||
      process.env.WORKSPACE_DIR ||
      process.env.PROJECT_DIR ||
      process.env.VSCODE_WORKSPACE;
    if (envDir) {
      const foundEnv = await findProject(envDir).catch(() => null);
      if (foundEnv) return foundEnv;
    }

    // 6. Single-connected-project fallback for global setups
    const connected = await listConnectedProjects().catch(() => []);
    if (connected.length === 1 && connected[0]) {
      const c = connected[0];
      if (c.projectPath) {
        const found = await findProject(c.projectPath).catch(() => null);
        if (found) return found;
      }
      return {
        project: {
          instance: c.instance,
          owner: c.ownerSlug,
          project: c.projectSlug ?? "default",
          projectId: c.projectId,
          space: c.projectSlug ?? "default",
        },
        at: c.projectPath ?? process.cwd(),
      };
    }

    return null;
  }

  async function getUpstreamClient(project: Project, rootDir: string): Promise<Client | null> {
    const projectIdentifier =
      project.projectId ??
      (project.owner ? `${project.owner}/${project.project}` : project.project);
    const held = await agentKeyForProject(project.instance, rootDir, agentName, projectIdentifier);
    if (!held) return null;

    const poolKey = `${project.instance}|${held.keyId}|${held.agentId ?? ""}|${agentName ?? ""}`;
    const cached = upstreamPool.get(poolKey);
    if (cached) return cached;

    const runtimeModel = detectActiveRuntimeModel(agentName);
    const upstream = new Client({ name: "memcell-cli", version: "0.3.0" });
    await upstream.connect(
      new StreamableHTTPClientTransport(new URL(`${project.instance}/mcp`), {
        requestInit: {
          headers: {
            authorization: `Bearer ${held.key}`,
            ...(held.agentId ? { "x-memcell-agent": held.agentId } : {}),
            ...(runtimeModel ? { "x-memcell-model": runtimeModel } : {}),
          },
        },
      }),
    );
    upstreamPool.set(poolKey, upstream);
    return upstream;
  }

  // Handle IDE root changes dynamically
  try {
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      // Roots changed in client (e.g. workspace folders added or removed)
    });
  } catch {
    // Ignore notification handler setup if not supported
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const resolved = await resolveCurrentProject();
    if (resolved) {
      try {
        const upstream = await getUpstreamClient(resolved.project, dirname(resolved.at));
        if (upstream) {
          return await upstream.listTools();
        }
      } catch {
        // Fall back to native default tools if upstream check fails
      }
    }
    return { tools: DEFAULT_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const workspaceHint =
      typeof args.workspace === "string"
        ? args.workspace
        : typeof args.project === "string"
          ? args.project
          : undefined;

    const resolved = await resolveCurrentProject(workspaceHint);
    if (!resolved) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No connected memcell project could be found for workspace (${process.cwd()}). Run 'memcell connect [owner]/<project>' in your workspace directory to pair memory.`,
          },
        ],
      };
    }

    const upstream = await getUpstreamClient(resolved.project, dirname(resolved.at));
    if (!upstream) {
      const projName =
        resolved.project.owner && resolved.project.project
          ? `${resolved.project.owner}/${resolved.project.project}`
          : resolved.project.project || resolved.project.space;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No agent key found on this machine for project '${projName}'. Run 'memcell connect' in this project directory to pair this machine.`,
          },
        ],
      };
    }

    return await upstream.callTool(request.params);
  });

  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    server.onclose = () => resolve();
  });

  for (const client of upstreamPool.values()) {
    await client.close().catch(() => undefined);
  }
  return 0;
}
