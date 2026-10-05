import type { Command, Resource } from "../model.js";
import { getProfile, updateProfile, listTokens, createToken, revokeToken } from "./account.js";
import {
  createAgent,
  createAgentKey,
  deleteAgent,
  getAgent,
  listAgents,
  revokeAgent,
  revokeAgentKey,
  updateAgent,
  whoamiAgent,
} from "./agents.js";
import {
  inviteCollaborator,
  listCollaborators,
  removeCollaborator,
  revokeCollaboratorInvite,
  updateCollaboratorRole,
} from "./collaborators.js";
import { exportAuditLogs, listAuditLogs } from "./audit.js";
import { configGet, configSet } from "./config.js";
import { connect } from "./connect.js";
import { exportSpace } from "./export.js";
import {
  getFleetAgent,
  grantFleetProject,
  listFleet,
  registerFleetAgent,
  resumeFleetAgent,
  revokeFleetProject,
  suspendFleetAgent,
} from "./fleet.js";
import { hook, hookRemove } from "./hook.js";
import { importFiles } from "./import.js";
import { getEnterpriseInsights } from "./insights.js";
import { login } from "./login.js";
import { logout } from "./logout.js";
import { mcp } from "./mcp.js";
import {
  configureOrgSSO,
  createOrganization,
  deleteOrganization,
  deleteOrgSSO,
  enforceOrgSSO,
  getOrganization,
  inviteOrgMember,
  listOrganizations,
  listOrgInvitations,
  listOrgMembers,
  listOrgSSO,
  removeOrgMember,
  revokeOrgInvitation,
  switchOrganization,
  updateOrganization,
  updateOrgMember,
  verifyOrgSSO,
} from "./orgs.js";
import {
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  newWorkspace,
  transferWorkspace,
  updateWorkspace,
  useWorkspace,
} from "./workspaces.js";
import { promote } from "./promote.js";
import { approvePromotion, listPromotions, rejectPromotion } from "./promotions.js";
import { recall } from "./recall.js";
import { remember } from "./remember.js";
import { report } from "./report.js";
import { pause, resume } from "./pause.js";
import { reset } from "./reset.js";
import { scopes } from "./scopes.js";
import { seed } from "./seed.js";
import {
  adoptMemory,
  createMemory,
  deleteMemory,
  getMemory,
  historyMemory,
  listMemories,
  memoryRelations,
  relateMemories,
  starMemory,
  unrelateMemories,
  updateMemory,
} from "./memories.js";
import { stats } from "./stats.js";
import { status } from "./status.js";
import { sweepConsolidate } from "./sweep.js";
import { getUsage } from "./usage.js";

/** The nouns, so help groups by resource instead of listing every verb. */
export const RESOURCES: Resource[] = [
  { name: "workspaces", what: "epistemic memory boundaries, and which one is active" },
  { name: "memories", what: "atomic units of thought, observation, and directive" },
  { name: "promotions", what: "scope promotion requests and governance review" },
  { name: "collaborators", what: "people with access to this workspace" },
  { name: "agents", what: "registered agents and access keys" },
  { name: "orgs", what: "organizations you belong to, and which one is active" },
  { name: "usage", what: "quotas, active metrics, and memory breakdowns" },
  { name: "account", what: "your profile and personal access tokens" },
  { name: "config", what: "settings, per workspace or machine" },
  { name: "sweep", what: "background consolidation and cognitive sleep cycles" },
];

export const COMMANDS: Command[] = [
  // ── Core Lifecycle & Authentication ────────────────────────────────────
  {
    path: ["login"],
    what: "sign this machine in",
    takes: ["url", "force", "no-browser", "sso"],
    landing: true,
    run: ({ instance, flags }) =>
      login(instance, {
        force: flags.force === true,
        noBrowser: flags["no-browser"] === true,
        sso: typeof flags.sso === "string" ? flags.sso : undefined,
      }),
  },
  {
    path: ["logout"],
    what: "sign out and forget the session here",
    takes: ["url"],
    run: ({ instance }) => logout(instance),
  },
  {
    path: ["connect"],
    what: "wire this directory — approves in your browser the first time",
    args: [
      {
        name: "project",
        required: false,
        what: "project to connect ([owner]/[project] or slug)",
      },
    ],
    takes: ["url", "pair", "project", "space", "agent", "no-browser"],
    landing: true,
    run: ({ instance, from, args, flags }) =>
      connect(instance, {
        pair: typeof flags.pair === "string" ? flags.pair : undefined,
        project:
          typeof args.project === "string"
            ? args.project
            : typeof flags.project === "string"
              ? flags.project
              : undefined,
        space: typeof flags.space === "string" ? flags.space : undefined,
        agent: typeof flags.agent === "string" ? flags.agent : undefined,
        noBrowser: flags["no-browser"] === true,
        from,
      }),
  },
  {
    path: ["status"],
    what: "who this machine is, and what this directory is linked to",
    takes: ["url"],
    landing: true,
    run: ({ instance, from }) => status(instance, from),
  },
  {
    path: ["reset"],
    what: "forget everything memcell keeps on this machine",
    takes: ["force"],
    landing: true,
    run: ({ flags }) => reset(flags.force === true),
  },
  {
    path: ["pause"],
    what: "pause background hooks for this project",
    landing: true,
    run: ({ from }) => pause(from),
  },
  {
    path: ["resume"],
    what: "resume background hooks for this project",
    landing: true,
    run: ({ from }) => resume(from),
  },
  {
    path: ["unpause"],
    what: "resume background hooks for this project (alias for resume)",
    run: ({ from }) => resume(from),
  },

  // ── High-Frequency Memory Loop Ergonomics ──────────────────────────────
  {
    path: ["recall"],
    what: "what memory serves before you act",
    args: [{ name: "intent", required: true, what: "what you are trying to do or know" }],
    takes: ["limit", "url", "scope", "scopes", "my-memory", "my", "meta", "metadata"],
    landing: true,
    run: ({ args, flags }) =>
      recall(
        args.intent!,
        typeof flags.limit === "string" ? flags.limit : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
        typeof flags.scope === "string" ? flags.scope : undefined,
        typeof flags.scopes === "string" ? flags.scopes : undefined,
        flags["my-memory"] === true || flags.my === true,
        typeof flags.meta === "string"
          ? flags.meta
          : typeof flags.metadata === "string"
            ? flags.metadata
            : undefined,
      ),
  },
  {
    path: ["remember"],
    what: "file one thing this project has established — --at names when a directive applies",
    args: [{ name: "text", required: true, what: "the claim, in one sentence" }],
    takes: ["type", "kind", "at", "url", "scope", "meta", "subject", "target", "roles"],
    run: ({ args, flags }) =>
      remember(
        args.text!,
        typeof flags.type === "string"
          ? flags.type
          : typeof flags.kind === "string"
            ? flags.kind
            : undefined,
        typeof flags.at === "string" ? flags.at : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
        typeof flags.scope === "string" ? flags.scope : undefined,
        typeof flags.meta === "string" ? flags.meta : undefined,
        typeof flags.subject === "string"
          ? flags.subject
          : typeof flags.target === "string"
            ? flags.target
            : undefined,
        typeof flags.roles === "string" ? flags.roles : undefined,
      ),
  },
  {
    path: ["report"],
    what: "what happened when something memory served was acted on",
    args: [
      { name: "memory", required: true, what: "the memory's id, from recall" },
      { name: "outcome", required: true, what: "worked · failed · avoided" },
    ],
    takes: ["note", "url"],
    run: ({ args, flags }) =>
      report(
        args.memory!,
        args.outcome!,
        typeof flags.note === "string" ? flags.note : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["promote"],
    what: "elevate a memory to workspace, team, or organization scope",
    args: [{ name: "memory", required: true, what: "the memory's id" }],
    takes: ["to", "reason", "url"],
    run: ({ args, flags }) =>
      promote(
        args.memory!,
        typeof flags.to === "string" ? flags.to : "workspace",
        typeof flags.reason === "string" ? flags.reason : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["promotions"],
    what: "list pending scope promotion requests for review",
    takes: ["url", "status", "project"],
    landing: true,
    run: ({ instance, flags }) => listPromotions(instance, flags),
  },
  {
    path: ["promotions", "list"],
    what: "list scope promotion requests for review",
    takes: ["url", "status", "project"],
    landing: true,
    run: ({ instance, flags }) => listPromotions(instance, flags),
  },
  {
    path: ["promotions", "approve"],
    what: "approve a pending scope promotion request",
    args: [{ name: "request", required: true, what: "the promotion request's id" }],
    takes: ["url", "reason", "project"],
    run: ({ instance, args, flags }) =>
      approvePromotion(
        instance,
        args.request!,
        typeof flags.reason === "string" ? flags.reason : undefined,
        flags,
      ),
  },
  {
    path: ["promotions", "reject"],
    what: "reject a pending scope promotion request",
    args: [{ name: "request", required: true, what: "the promotion request's id" }],
    takes: ["url", "reason", "project"],
    run: ({ instance, args, flags }) =>
      rejectPromotion(
        instance,
        args.request!,
        typeof flags.reason === "string" ? flags.reason : undefined,
        flags,
      ),
  },
  {
    path: ["scopes"],
    what: "list active operational scopes in this project",
    takes: ["url"],
    landing: true,
    run: ({ flags }) => scopes(typeof flags.url === "string" ? flags.url : undefined),
  },
  {
    path: ["stats"],
    what: "what your agents did, and what it saved in tokens not spent",
    takes: ["url"],
    run: ({ instance }) => stats(instance),
  },

  // ── Sweep & Epistemic Consolidation ───────────────────────────────────
  {
    path: ["sweep"],
    what: "run an epistemic consolidation sweep over the active project",
    takes: [
      "url",
      "project",
      "owner",
      "min-similarity",
      "min-cluster-size",
      "max-cluster-size",
      "wait",
      "no-wait",
      "json",
    ],
    landing: true,
    run: ({ instance, flags, context }) => sweepConsolidate(instance, flags, context),
  },
  {
    path: ["sweep", "consolidate"],
    what: "run an epistemic consolidation sweep over the active project",
    takes: [
      "url",
      "project",
      "owner",
      "min-similarity",
      "min-cluster-size",
      "max-cluster-size",
      "wait",
      "no-wait",
      "json",
    ],
    landing: true,
    run: ({ instance, flags, context }) => sweepConsolidate(instance, flags, context),
  },

  // ── Memories Resource ──────────────────────────────────────────────────
  {
    path: ["memories"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    landing: true,
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memories", "list"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memories", "ls"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memories", "get"],
    what: "inspect details of a memory by ID",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => getMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "create"],
    what: "create a memory directly in the workspace",
    args: [{ name: "text", required: true, what: "the memory text" }],
    takes: [
      "url",
      "workspace",
      "name",
      "type",
      "scope",
      "status",
      "meta",
      "roles",
      "subject",
      "target",
    ],
    run: ({ instance, args, flags }) => createMemory(instance, args.text!, flags),
  },
  {
    path: ["memories", "new"],
    what: "create a memory directly in the workspace",
    args: [{ name: "text", required: true, what: "the memory text" }],
    takes: [
      "url",
      "workspace",
      "name",
      "type",
      "scope",
      "status",
      "meta",
      "roles",
      "subject",
      "target",
    ],
    run: ({ instance, args, flags }) => createMemory(instance, args.text!, flags),
  },
  {
    path: ["memories", "update"],
    what: "update a memory's content, status, or type",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "text", "name", "type", "status", "meta"],
    run: ({ instance, args, flags }) => updateMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "delete"],
    what: "delete a memory or latest version",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "all"],
    run: ({ instance, args, flags }) => deleteMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "star"],
    what: "star or unstar a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => starMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "history"],
    what: "view revision and outcome history of a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => historyMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "adopt"],
    what: "adopt an existing memory into another workspace",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "into", "to"],
    run: ({ instance, args, flags }) => adoptMemory(instance, args.id!, flags),
  },
  {
    path: ["memories", "promote"],
    what: "elevate a memory to workspace, team, or organization scope",
    args: [{ name: "memory", required: true, what: "memory ID" }],
    takes: ["to", "reason", "url"],
    run: ({ args, flags }) =>
      promote(
        args.memory!,
        typeof flags.to === "string" ? flags.to : "workspace",
        typeof flags.reason === "string" ? flags.reason : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["memories", "relate"],
    what: "declare a directed epistemic relation edge between memories",
    args: [
      { name: "source", required: true, what: "source memory ID" },
      { name: "target", required: true, what: "target memory ID" },
    ],
    takes: ["url", "workspace", "type", "confidence"],
    run: ({ instance, args, flags }) => relateMemories(instance, args.source!, args.target!, flags),
  },
  {
    path: ["memories", "unrelate"],
    what: "remove an epistemic relation edge between memories",
    args: [
      {
        name: "arg1",
        required: true,
        what: "relation ID (or source memory ID if relation ID is second)",
      },
      { name: "arg2", required: false, what: "relation ID (if source memory ID is first)" },
    ],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => unrelateMemories(instance, args.arg1!, args.arg2, flags),
  },
  {
    path: ["memories", "relations"],
    what: "list incoming and outgoing epistemic relations for a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => memoryRelations(instance, args.id!, flags),
  },
  {
    path: ["memory"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memory", "list"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memory", "ls"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["memory", "get"],
    what: "inspect details of a memory by ID",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => getMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "create"],
    what: "create a memory directly in the workspace",
    args: [{ name: "text", required: true, what: "the memory text" }],
    takes: [
      "url",
      "workspace",
      "name",
      "type",
      "scope",
      "status",
      "meta",
      "roles",
      "subject",
      "target",
    ],
    run: ({ instance, args, flags }) => createMemory(instance, args.text!, flags),
  },
  {
    path: ["memory", "new"],
    what: "create a memory directly in the workspace",
    args: [{ name: "text", required: true, what: "the memory text" }],
    takes: [
      "url",
      "workspace",
      "name",
      "type",
      "scope",
      "status",
      "meta",
      "roles",
      "subject",
      "target",
    ],
    run: ({ instance, args, flags }) => createMemory(instance, args.text!, flags),
  },
  {
    path: ["memory", "update"],
    what: "update a memory's content, status, or type",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "text", "name", "type", "status", "meta"],
    run: ({ instance, args, flags }) => updateMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "delete"],
    what: "delete a memory or latest version",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "all"],
    run: ({ instance, args, flags }) => deleteMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "star"],
    what: "star or unstar a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => starMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "history"],
    what: "view revision and outcome history of a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => historyMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "adopt"],
    what: "adopt an existing memory into another workspace",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace", "into", "to"],
    run: ({ instance, args, flags }) => adoptMemory(instance, args.id!, flags),
  },
  {
    path: ["memory", "promote"],
    what: "elevate a memory to workspace, team, or organization scope",
    args: [{ name: "memory", required: true, what: "memory ID" }],
    takes: ["to", "reason", "url"],
    run: ({ args, flags }) =>
      promote(
        args.memory!,
        typeof flags.to === "string" ? flags.to : "workspace",
        typeof flags.reason === "string" ? flags.reason : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["memory", "relate"],
    what: "declare a directed epistemic relation edge between memories",
    args: [
      { name: "source", required: true, what: "source memory ID" },
      { name: "target", required: true, what: "target memory ID" },
    ],
    takes: ["url", "workspace", "type", "confidence"],
    run: ({ instance, args, flags }) => relateMemories(instance, args.source!, args.target!, flags),
  },
  {
    path: ["memory", "unrelate"],
    what: "remove an epistemic relation edge between memories",
    args: [
      {
        name: "arg1",
        required: true,
        what: "relation ID (or source memory ID if relation ID is second)",
      },
      { name: "arg2", required: false, what: "relation ID (if source memory ID is first)" },
    ],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => unrelateMemories(instance, args.arg1!, args.arg2, flags),
  },
  {
    path: ["memory", "relations"],
    what: "list incoming and outgoing epistemic relations for a memory",
    args: [{ name: "id", required: true, what: "memory ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => memoryRelations(instance, args.id!, flags),
  },
  {
    path: ["list"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    landing: true,
    run: ({ instance, flags }) => listMemories(instance, flags),
  },
  {
    path: ["ls"],
    what: "list memories in the active workspace",
    takes: ["url", "workspace", "type", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listMemories(instance, flags),
  },

  // ── Workspaces Resource ────────────────────────────────────────────────
  {
    path: ["workspaces"],
    what: "list workspaces",
    takes: ["url", "owner"],
    landing: true,
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspaces", "ls"],
    what: "list workspaces",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspaces", "list"],
    what: "list workspaces",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspaces", "get"],
    what: "view workspace details",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url"],
    run: ({ instance, args, flags }) => getWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspaces", "new"],
    what: "create a new workspace",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newWorkspace(instance, args.name!, flags),
  },
  {
    path: ["workspaces", "create"],
    what: "create a new workspace",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newWorkspace(instance, args.name!, flags),
  },
  {
    path: ["workspaces", "update"],
    what: "update workspace settings and description",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url", "name", "description"],
    run: ({ instance, args, flags }) => updateWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspaces", "delete"],
    what: "delete a workspace",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url"],
    run: ({ instance, args }) => deleteWorkspace(instance, args.slug!),
  },
  {
    path: ["workspaces", "transfer"],
    what: "transfer workspace ownership to another user or organization",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url", "to", "owner"],
    run: ({ instance, args, flags }) => transferWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspaces", "use"],
    what: "work on this workspace from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useWorkspace(instance, args.slug!),
  },
  {
    path: ["workspaces", "switch"],
    what: "work on this workspace from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useWorkspace(instance, args.slug!),
  },
  {
    path: ["workspace"],
    what: "list workspaces",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspace", "ls"],
    what: "list workspaces",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspace", "list"],
    what: "list workspaces",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listWorkspaces(instance, flags),
  },
  {
    path: ["workspace", "get"],
    what: "view workspace details",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url"],
    run: ({ instance, args, flags }) => getWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspace", "new"],
    what: "create a new workspace",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newWorkspace(instance, args.name!, flags),
  },
  {
    path: ["workspace", "create"],
    what: "create a new workspace",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newWorkspace(instance, args.name!, flags),
  },
  {
    path: ["workspace", "update"],
    what: "update workspace settings and description",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url", "name", "description"],
    run: ({ instance, args, flags }) => updateWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspace", "delete"],
    what: "delete a workspace",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url"],
    run: ({ instance, args }) => deleteWorkspace(instance, args.slug!),
  },
  {
    path: ["workspace", "transfer"],
    what: "transfer workspace ownership to another user or organization",
    args: [{ name: "slug", required: true, what: "workspace slug or [owner]/[workspace]" }],
    takes: ["url", "to", "owner"],
    run: ({ instance, args, flags }) => transferWorkspace(instance, args.slug!, flags),
  },
  {
    path: ["workspace", "use"],
    what: "work on this workspace from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useWorkspace(instance, args.slug!),
  },
  {
    path: ["workspace", "switch"],
    what: "work on this workspace from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useWorkspace(instance, args.slug!),
  },

  // ── Collaborators Resource ─────────────────────────────────────────────
  {
    path: ["collaborators"],
    what: "list workspace collaborators and pending invitations",
    args: [{ name: "workspace", required: false, what: "optional workspace namespace" }],
    takes: ["url", "workspace", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.workspace, flags),
  },
  {
    path: ["collaborators", "list"],
    what: "list workspace collaborators and pending invitations",
    args: [{ name: "workspace", required: false, what: "optional workspace namespace" }],
    takes: ["url", "workspace", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.workspace, flags),
  },
  {
    path: ["collaborators", "ls"],
    what: "list workspace collaborators and pending invitations",
    args: [{ name: "workspace", required: false, what: "optional workspace namespace" }],
    takes: ["url", "workspace", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.workspace, flags),
  },
  {
    path: ["collaborators", "invite"],
    what: "invite a collaborator to the workspace",
    args: [{ name: "email", required: true, what: "collaborator email" }],
    takes: ["url", "workspace", "role"],
    run: ({ instance, args, flags }) => inviteCollaborator(instance, args.email!, flags),
  },
  {
    path: ["collaborators", "update-role"],
    what: "update a collaborator's access role",
    args: [{ name: "user", required: true, what: "collaborator user ID" }],
    takes: ["url", "workspace", "role"],
    run: ({ instance, args, flags }) => updateCollaboratorRole(instance, args.user!, flags),
  },
  {
    path: ["collaborators", "remove"],
    what: "remove a collaborator from the workspace",
    args: [{ name: "user", required: true, what: "collaborator user ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => removeCollaborator(instance, args.user!, flags),
  },
  {
    path: ["collaborators", "revoke-invite"],
    what: "revoke a pending workspace invitation",
    args: [{ name: "invitation", required: true, what: "invitation ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => revokeCollaboratorInvite(instance, args.invitation!, flags),
  },

  // ── Agents Resource ────────────────────────────────────────────────────
  {
    path: ["agents"],
    what: "list agents and access keys",
    takes: ["url", "workspace"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "ls"],
    what: "list agents and access keys",
    takes: ["url", "workspace"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "list"],
    what: "list agents and access keys",
    takes: ["url", "workspace"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "get"],
    what: "inspect details of a registered agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => getAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "new"],
    what: "register a new agent in the workspace",
    args: [{ name: "name", required: true, what: "agent name" }],
    takes: ["url", "workspace", "description", "type"],
    run: ({ instance, args, flags }) => createAgent(instance, args.name!, flags),
  },
  {
    path: ["agents", "create"],
    what: "register a new agent in the workspace",
    args: [{ name: "name", required: true, what: "agent name" }],
    takes: ["url", "workspace", "description", "type"],
    run: ({ instance, args, flags }) => createAgent(instance, args.name!, flags),
  },
  {
    path: ["agents", "update"],
    what: "update a registered agent's settings",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "workspace", "name", "description", "status"],
    run: ({ instance, args, flags }) => updateAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "delete"],
    what: "delete a registered agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => deleteAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "key", "create"],
    what: "mint a new API key for an agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => createAgentKey(instance, args.id!, flags),
  },
  {
    path: ["agents", "key", "revoke"],
    what: "revoke an agent API key",
    args: [
      { name: "first", required: true, what: "key ID or agent ID" },
      { name: "second", required: false, what: "key ID (when first is agent ID)" },
    ],
    takes: ["url", "workspace"],
    run: ({ instance, args, flags }) => revokeAgentKey(instance, args.first!, args.second, flags),
  },
  {
    path: ["agents", "whoami"],
    what: "inspect current active agent key standing and quotas",
    takes: ["url"],
    run: ({ instance }) => whoamiAgent(instance),
  },
  {
    path: ["agents", "revoke"],
    what: "take one agent's key back",
    args: [{ name: "id", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => revokeAgent(instance, args.id!),
  },

  // ── Organizations Resource ─────────────────────────────────────────────
  {
    path: ["orgs"],
    what: "list organizations you belong to",
    takes: ["url"],
    run: ({ instance }) => listOrganizations(instance),
  },
  {
    path: ["orgs", "list"],
    what: "list organizations you belong to",
    takes: ["url"],
    run: ({ instance }) => listOrganizations(instance),
  },
  {
    path: ["orgs", "ls"],
    what: "list organizations you belong to",
    takes: ["url"],
    run: ({ instance }) => listOrganizations(instance),
  },
  {
    path: ["orgs", "get"],
    what: "view organization profile and details",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url"],
    run: ({ instance, args }) => getOrganization(instance, args.slug!),
  },
  {
    path: ["orgs", "create"],
    what: "create a new organization and set active context",
    args: [{ name: "slug", required: true, what: "unique url handle" }],
    takes: ["name", "url"],
    run: ({ instance, args, flags }) =>
      createOrganization(instance, args.slug!, {
        name: typeof flags.name === "string" ? flags.name : undefined,
      }),
  },
  {
    path: ["orgs", "new"],
    what: "create a new organization and set active context",
    args: [{ name: "slug", required: true, what: "unique url handle" }],
    takes: ["name", "url"],
    run: ({ instance, args, flags }) =>
      createOrganization(instance, args.slug!, {
        name: typeof flags.name === "string" ? flags.name : undefined,
      }),
  },
  {
    path: ["orgs", "update"],
    what: "update organization profile name",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["name", "url"],
    run: ({ instance, args, flags }) =>
      updateOrganization(instance, args.slug!, {
        name: typeof flags.name === "string" ? flags.name : undefined,
      }),
  },
  {
    path: ["orgs", "delete"],
    what: "delete an organization",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url"],
    run: ({ instance, args }) => deleteOrganization(instance, args.slug!),
  },
  {
    path: ["orgs", "switch"],
    what: "switch active CLI organization context (or 'personal')",
    args: [{ name: "slug", required: true, what: "from the list, or 'personal'" }],
    takes: ["url"],
    run: ({ instance, args }) => switchOrganization(instance, args.slug!),
  },
  {
    path: ["orgs", "use"],
    what: "switch active CLI organization context (or 'personal')",
    args: [{ name: "slug", required: true, what: "from the list, or 'personal'" }],
    takes: ["url"],
    run: ({ instance, args }) => switchOrganization(instance, args.slug!),
  },
  {
    path: ["orgs", "members"],
    what: "list organization members",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url", "role"],
    run: ({ instance, args, flags }) => listOrgMembers(instance, args.slug!, flags),
  },
  {
    path: ["orgs", "member", "update"],
    what: "update an organization member's role",
    args: [
      { name: "slug", required: true, what: "organization handle" },
      { name: "user", required: true, what: "user ID" },
    ],
    takes: ["url", "role"],
    run: ({ instance, args, flags }) => updateOrgMember(instance, args.slug!, args.user!, flags),
  },
  {
    path: ["orgs", "member", "remove"],
    what: "remove a member from the organization",
    args: [
      { name: "slug", required: true, what: "organization handle" },
      { name: "user", required: true, what: "user ID" },
    ],
    takes: ["url"],
    run: ({ instance, args }) => removeOrgMember(instance, args.slug!, args.user!),
  },
  {
    path: ["orgs", "invites"],
    what: "list pending organization invitations",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url"],
    run: ({ instance, args }) => listOrgInvitations(instance, args.slug!),
  },
  {
    path: ["orgs", "invite"],
    what: "invite a new member to the organization",
    args: [
      { name: "slug", required: true, what: "organization handle" },
      { name: "email", required: true, what: "user email to invite" },
    ],
    takes: ["url", "role"],
    run: ({ instance, args, flags }) => inviteOrgMember(instance, args.slug!, args.email!, flags),
  },
  {
    path: ["orgs", "invite", "revoke"],
    what: "revoke a pending organization invitation",
    args: [
      { name: "slug", required: true, what: "organization handle" },
      { name: "invitation", required: true, what: "invitation ID" },
    ],
    takes: ["url"],
    run: ({ instance, args }) => revokeOrgInvitation(instance, args.slug!, args.invitation!),
  },
  {
    path: ["orgs", "sso"],
    what: "list configured SSO identity providers for an organization",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url"],
    run: ({ instance, args }) => listOrgSSO(instance, args.slug!),
  },
  {
    path: ["orgs", "sso", "list"],
    what: "list configured SSO identity providers for an organization",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url"],
    run: ({ instance, args }) => listOrgSSO(instance, args.slug!),
  },
  {
    path: ["orgs", "sso", "configure"],
    what: "configure or update a SAML or OIDC provider for an organization",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: [
      "url",
      "provider-id",
      "provider",
      "type",
      "domain",
      "metadata-url",
      "metadata-xml",
      "client-id",
      "client-secret",
      "issuer",
      "authorization-endpoint",
      "token-endpoint",
      "user-info-endpoint",
      "jwks-uri",
    ],
    run: ({ instance, args, flags }) => configureOrgSSO(instance, args.slug!, flags),
  },
  {
    path: ["orgs", "sso", "verify"],
    what: "verify DNS TXT record for an organization SSO domain",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url", "provider-id", "provider"],
    run: ({ instance, args, flags }) => verifyOrgSSO(instance, args.slug!, flags),
  },
  {
    path: ["orgs", "sso", "enforce"],
    what: "enable or disable strict SSO enforcement for an organization",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url", "enable", "disable", "off"],
    run: ({ instance, args, flags }) => enforceOrgSSO(instance, args.slug!, flags),
  },
  {
    path: ["orgs", "sso", "delete"],
    what: "delete an organization SSO provider configuration",
    args: [{ name: "slug", required: true, what: "organization handle" }],
    takes: ["url", "provider-id", "provider"],
    run: ({ instance, args, flags }) => deleteOrgSSO(instance, args.slug!, flags),
  },

  // ── Usage & Telemetry Resource ─────────────────────────────────────────
  {
    path: ["usage"],
    what: "inspect account or organization usage, quotas, and memory breakdowns",
    args: [{ name: "owner", required: false, what: "optional user or org handle" }],
    takes: ["url", "owner", "timeframe"],
    run: ({ instance, args, flags }) => getUsage(instance, args.owner, flags),
  },
  {
    path: ["usage", "get"],
    what: "inspect account or organization usage, quotas, and memory breakdowns",
    args: [{ name: "owner", required: false, what: "optional user or org handle" }],
    takes: ["url", "owner", "timeframe"],
    run: ({ instance, args, flags }) => getUsage(instance, args.owner, flags),
  },

  // ── Account Resource ───────────────────────────────────────────────────
  {
    path: ["account"],
    what: "view authenticated user profile",
    takes: ["url"],
    run: ({ instance }) => getProfile(instance),
  },
  {
    path: ["account", "profile"],
    what: "view authenticated user profile",
    takes: ["url"],
    run: ({ instance }) => getProfile(instance),
  },
  {
    path: ["account", "update"],
    what: "update profile information",
    takes: ["url", "name"],
    run: ({ instance, flags }) => updateProfile(instance, flags),
  },
  {
    path: ["account", "tokens"],
    what: "list personal access tokens",
    takes: ["url"],
    run: ({ instance }) => listTokens(instance),
  },
  {
    path: ["account", "tokens", "list"],
    what: "list personal access tokens",
    takes: ["url"],
    run: ({ instance }) => listTokens(instance),
  },
  {
    path: ["account", "tokens", "ls"],
    what: "list personal access tokens",
    takes: ["url"],
    run: ({ instance }) => listTokens(instance),
  },
  {
    path: ["account", "tokens", "create"],
    what: "create a new personal access token",
    args: [{ name: "name", required: true, what: "token name/label" }],
    takes: ["url", "expires"],
    run: ({ instance, args, flags }) => createToken(instance, args.name!, flags),
  },
  {
    path: ["account", "tokens", "new"],
    what: "create a new personal access token",
    args: [{ name: "name", required: true, what: "token name/label" }],
    takes: ["url", "expires"],
    run: ({ instance, args, flags }) => createToken(instance, args.name!, flags),
  },
  {
    path: ["account", "tokens", "revoke"],
    what: "revoke a personal access token",
    args: [{ name: "id", required: true, what: "token ID" }],
    takes: ["url"],
    run: ({ instance, args }) => revokeToken(instance, args.id!),
  },

  // ── Integration & Tooling ──────────────────────────────────────────────
  {
    path: ["import"],
    what: "bring existing guidance or instruction files into memory — bare, it finds them",
    args: [{ name: "files", rest: true, what: "documents or a JSON export to distill" }],
    takes: ["url", "dry-run", "scope", "type", "json"],
    landing: true,
    run: ({ many, flags, context }) =>
      importFiles({
        files: many.files ?? [],
        url: typeof flags.url === "string" ? flags.url : undefined,
        project: typeof flags.project === "string" ? flags.project : context?.project?.namespace,
        owner: typeof flags.owner === "string" ? flags.owner : (context?.owner ?? undefined),
        dryRun: Boolean(flags["dry-run"]),
        scope: typeof flags.scope === "string" ? flags.scope : undefined,
        type: typeof flags.type === "string" ? flags.type : undefined,
        json: Boolean(flags.json),
      }),
  },
  {
    path: ["export"],
    what: "carry this space out — one document, no account needed",
    takes: ["format", "out", "url"],
    landing: true,
    run: ({ flags, context }) =>
      exportSpace(
        typeof flags.format === "string" ? flags.format : "json",
        typeof flags.out === "string" ? flags.out : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
        typeof flags.project === "string" ? flags.project : context?.project?.namespace,
      ),
  },
  {
    path: ["hook"],
    what: "what an installed hook runs",
    args: [
      { name: "moment", required: true, what: "the lifecycle moment" },
      { name: "program", required: true, what: "the agent program, for its output format" },
    ],
    takes: ["agent"],
    hidden: true,
    run: ({ args }) => hook(args.moment ?? "", args.program ?? ""),
  },
  {
    path: ["hook", "remove"],
    what: "take memcell's hooks out of this directory",
    landing: true,
    run: () => hookRemove(),
  },
  {
    path: ["mcp"],
    what: "the stdio face of this directory's memory, for MCP clients",
    takes: ["dir", "agent"],
    hidden: true,
    run: ({ flags }) =>
      mcp(
        typeof flags.dir === "string" ? flags.dir : undefined,
        typeof flags.agent === "string" ? flags.agent : undefined,
      ),
  },
  {
    path: ["config", "get"],
    what: "what a setting is here, and which file said so",
    args: [{ name: "key", required: true, what: "a dotted path, e.g. recall.limit" }],
    takes: ["global"],
    run: ({ args, flags }) => configGet(args.key!, flags.global === true),
  },
  {
    path: ["config", "set"],
    what: "set it for this project, or for this machine",
    args: [
      { name: "key", required: true, what: "a dotted path, e.g. recall.limit" },
      { name: "value", required: true, what: "the value to store" },
    ],
    takes: ["global"],
    run: ({ args, flags }) => configSet(args.key!, args.value!, flags.global === true),
  },
  {
    path: ["memories", "seed"],
    what: "put a source into the commons, or propose one",
    args: [{ name: "source", required: true, what: "a repository or documentation URL" }],
    takes: ["url", "reason", "no-watch"],
    run: ({ instance, args, flags }) =>
      seed(instance, args.source, {
        reason: typeof flags.reason === "string" ? flags.reason : undefined,
        watch: flags["no-watch"] !== true,
      }),
  },

  // ── Fleet Resource ─────────────────────────────────────────────────────
  {
    path: ["fleet"],
    what: "list autonomous agent fleet across the organization",
    takes: ["url", "org", "scope", "status", "health", "team", "project", "json"],
    run: ({ instance, flags }) => listFleet(instance, flags),
  },
  {
    path: ["fleet", "list"],
    what: "list autonomous agent fleet across the organization",
    takes: ["url", "org", "scope", "status", "health", "team", "project", "json"],
    run: ({ instance, flags }) => listFleet(instance, flags),
  },
  {
    path: ["fleet", "ls"],
    what: "list autonomous agent fleet across the organization",
    takes: ["url", "org", "scope", "status", "health", "team", "project", "json"],
    run: ({ instance, flags }) => listFleet(instance, flags),
  },
  {
    path: ["fleet", "get"],
    what: "inspect agent configuration, credentials, and cross-project grants",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org", "json"],
    run: ({ instance, args, flags }) => getFleetAgent(instance, args.agentId!, flags),
  },
  {
    path: ["fleet", "register"],
    what: "register a new autonomous agent in the organizational fleet",
    args: [{ name: "name", required: true, what: "display name for the agent" }],
    takes: [
      "url",
      "org",
      "slug",
      "scope",
      "framework",
      "model",
      "description",
      "team",
      "project",
      "no-key",
      "json",
    ],
    run: ({ instance, args, flags }) => registerFleetAgent(instance, args.name!, flags),
  },
  {
    path: ["fleet", "suspend"],
    what: "emergency kill-switch to immediately block gateway access for an agent",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org", "reason"],
    run: ({ instance, args, flags }) => suspendFleetAgent(instance, args.agentId!, flags),
  },
  {
    path: ["fleet", "kill"],
    what: "emergency kill-switch to immediately block gateway access for an agent",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org", "reason"],
    run: ({ instance, args, flags }) => suspendFleetAgent(instance, args.agentId!, flags),
  },
  {
    path: ["fleet", "resume"],
    what: "reactivate a suspended agent and restore gateway access",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org"],
    run: ({ instance, args, flags }) => resumeFleetAgent(instance, args.agentId!, flags),
  },
  {
    path: ["fleet", "grant"],
    what: "grant cross-project access for an agent to a specific project",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org", "project", "permission"],
    run: ({ instance, args, flags }) => grantFleetProject(instance, args.agentId!, flags),
  },
  {
    path: ["fleet", "revoke"],
    what: "revoke cross-project access for an agent from a project",
    args: [{ name: "agentId", required: true, what: "agent id" }],
    takes: ["url", "org", "project"],
    run: ({ instance, args, flags }) => revokeFleetProject(instance, args.agentId!, flags),
  },

  // ── Audit Resource ─────────────────────────────────────────────────────
  {
    path: ["audit"],
    what: "list immutable enterprise audit events",
    takes: [
      "url",
      "org",
      "actor",
      "actor-type",
      "action",
      "target-type",
      "target-id",
      "project",
      "team",
      "from",
      "to",
      "limit",
      "json",
    ],
    run: ({ instance, flags }) => listAuditLogs(instance, flags),
  },
  {
    path: ["audit", "list"],
    what: "list immutable enterprise audit events",
    takes: [
      "url",
      "org",
      "actor",
      "actor-type",
      "action",
      "target-type",
      "target-id",
      "project",
      "team",
      "from",
      "to",
      "limit",
      "json",
    ],
    run: ({ instance, flags }) => listAuditLogs(instance, flags),
  },
  {
    path: ["audit", "ls"],
    what: "list immutable enterprise audit events",
    takes: [
      "url",
      "org",
      "actor",
      "actor-type",
      "action",
      "target-type",
      "target-id",
      "project",
      "team",
      "from",
      "to",
      "limit",
      "json",
    ],
    run: ({ instance, flags }) => listAuditLogs(instance, flags),
  },
  {
    path: ["audit", "export"],
    what: "export enterprise audit logs formatted for SIEM (CEF, JSON, or CSV)",
    takes: ["url", "org", "format", "out", "from", "to", "action", "project"],
    run: ({ instance, flags }) => exportAuditLogs(instance, flags),
  },

  // ── Insights Resource ──────────────────────────────────────────────────
  {
    path: ["insights"],
    what: "view enterprise cognitive telemetry, savings economics, and latency KPIs",
    takes: ["url", "org", "timeframe", "team", "project", "json"],
    run: ({ instance, flags }) => getEnterpriseInsights(instance, flags),
  },
];
