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
import { configGet, configSet } from "./config.js";
import { connect } from "./connect.js";
import { exportSpace } from "./export.js";
import { hook, hookRemove } from "./hook.js";
import { importFiles } from "./import.js";
import { login } from "./login.js";
import { logout } from "./logout.js";
import { mcp } from "./mcp.js";
import {
  createOrganization,
  deleteOrganization,
  getOrganization,
  inviteOrgMember,
  listOrganizations,
  listOrgInvitations,
  listOrgMembers,
  removeOrgMember,
  revokeOrgInvitation,
  switchOrganization,
  updateOrganization,
  updateOrgMember,
} from "./orgs.js";
import {
  deleteProject,
  getProject,
  listProjects,
  newProject,
  transferProject,
  updateProject,
  useProject,
} from "./projects.js";
import { promote } from "./promote.js";
import { recall } from "./recall.js";
import { remember } from "./remember.js";
import { report } from "./report.js";
import { pause, resume } from "./pause.js";
import { reset } from "./reset.js";
import { scopes } from "./scopes.js";
import { seed } from "./seed.js";
import {
  adoptStatement,
  createStatement,
  deleteStatement,
  getStatement,
  historyStatement,
  listStatements,
  relateStatements,
  starStatement,
  statementRelations,
  unrelateStatements,
  updateStatement,
} from "./statements.js";
import { stats } from "./stats.js";
import { status } from "./status.js";
import { sweepConsolidate } from "./sweep.js";
import { getUsage } from "./usage.js";

/** The nouns, so help groups by resource instead of listing every verb. */
export const RESOURCES: Resource[] = [
  { name: "statements", what: "atomic units of memory, lifecycle and exploration" },
  { name: "projects", what: "what you work on, and which one is active" },
  { name: "collaborators", what: "people with access to this project" },
  { name: "agents", what: "registered agents and access keys" },
  { name: "orgs", what: "organizations you belong to, and which one is active" },
  { name: "usage", what: "quotas, active metrics, and statement breakdowns" },
  { name: "account", what: "your profile and personal access tokens" },
  { name: "config", what: "settings, per project or per machine" },
  { name: "sweep", what: "background consolidation and cognitive sleep cycles" },
  { name: "memories", what: "the commons" },
];

export const COMMANDS: Command[] = [
  // ── Core Lifecycle & Authentication ────────────────────────────────────
  {
    path: ["login"],
    what: "sign this machine in",
    takes: ["url", "force", "no-browser"],
    landing: true,
    run: ({ instance, flags }) =>
      login(instance, { force: flags.force === true, noBrowser: flags["no-browser"] === true }),
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
    takes: ["limit", "url", "scope", "scopes"],
    landing: true,
    run: ({ args, flags }) =>
      recall(
        args.intent!,
        typeof flags.limit === "string" ? flags.limit : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
        typeof flags.scope === "string" ? flags.scope : undefined,
        typeof flags.scopes === "string" ? flags.scopes : undefined,
      ),
  },
  {
    path: ["remember"],
    what: "file one thing this project has established — --at names when a directive applies",
    args: [{ name: "text", required: true, what: "the claim, in one sentence" }],
    takes: ["type", "kind", "at", "url", "scope", "meta"],
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
      ),
  },
  {
    path: ["report"],
    what: "what happened when something memory served was acted on",
    args: [
      { name: "statement", required: true, what: "the statement's id, from recall" },
      { name: "outcome", required: true, what: "worked · failed · avoided" },
    ],
    takes: ["note", "url"],
    run: ({ args, flags }) =>
      report(
        args.statement!,
        args.outcome!,
        typeof flags.note === "string" ? flags.note : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["promote"],
    what: "elevate a statement to common baseline or target scope",
    args: [{ name: "statement", required: true, what: "the statement's id" }],
    takes: ["to", "reason", "url"],
    run: ({ args, flags }) =>
      promote(
        args.statement!,
        typeof flags.to === "string" ? flags.to : "common",
        typeof flags.reason === "string" ? flags.reason : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
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

  // ── Statements Resource ────────────────────────────────────────────────
  {
    path: ["statements"],
    what: "list statements in the active project",
    takes: ["url", "project", "type", "kind", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listStatements(instance, flags),
  },
  {
    path: ["statements", "list"],
    what: "list statements in the active project",
    takes: ["url", "project", "type", "kind", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listStatements(instance, flags),
  },
  {
    path: ["statements", "ls"],
    what: "list statements in the active project",
    takes: ["url", "project", "type", "kind", "status", "scope", "query", "limit", "page"],
    run: ({ instance, flags }) => listStatements(instance, flags),
  },
  {
    path: ["statements", "get"],
    what: "inspect details of a statement by ID",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => getStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "create"],
    what: "create a statement directly in the project",
    args: [{ name: "text", required: true, what: "the statement text" }],
    takes: ["url", "project", "name", "type", "kind", "scope", "status", "meta"],
    run: ({ instance, args, flags }) => createStatement(instance, args.text!, flags),
  },
  {
    path: ["statements", "new"],
    what: "create a statement directly in the project",
    args: [{ name: "text", required: true, what: "the statement text" }],
    takes: ["url", "project", "name", "type", "kind", "scope", "status", "meta"],
    run: ({ instance, args, flags }) => createStatement(instance, args.text!, flags),
  },
  {
    path: ["statements", "update"],
    what: "update a statement's content, status, or type",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project", "text", "name", "type", "status", "meta"],
    run: ({ instance, args, flags }) => updateStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "delete"],
    what: "delete a statement",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => deleteStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "star"],
    what: "star or unstar a statement",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => starStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "history"],
    what: "view revision and outcome history of a statement",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => historyStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "adopt"],
    what: "adopt a statement into another project",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project", "into", "to"],
    run: ({ instance, args, flags }) => adoptStatement(instance, args.id!, flags),
  },
  {
    path: ["statements", "promote"],
    what: "elevate a statement to common baseline or target scope",
    args: [{ name: "statement", required: true, what: "statement ID" }],
    takes: ["to", "reason", "url"],
    run: ({ args, flags }) =>
      promote(
        args.statement!,
        typeof flags.to === "string" ? flags.to : "common",
        typeof flags.reason === "string" ? flags.reason : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["statements", "relate"],
    what: "connect two statements with an epistemic relation edge",
    args: [
      { name: "source", required: true, what: "source statement ID" },
      { name: "target", required: true, what: "target statement ID" },
    ],
    takes: ["url", "project", "type", "confidence"],
    run: ({ instance, args, flags }) =>
      relateStatements(instance, args.source!, args.target!, flags),
  },
  {
    path: ["statements", "unrelate"],
    what: "remove an epistemic relation edge between statements",
    args: [
      {
        name: "arg1",
        required: true,
        what: "relation ID (or source statement ID if relation ID is second)",
      },
      { name: "arg2", required: false, what: "relation ID (if source statement ID is first)" },
    ],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => unrelateStatements(instance, args.arg1!, args.arg2, flags),
  },
  {
    path: ["statements", "relations"],
    what: "list incoming and outgoing epistemic relations for a statement",
    args: [{ name: "id", required: true, what: "statement ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => statementRelations(instance, args.id!, flags),
  },

  // ── Projects Resource ──────────────────────────────────────────────────
  {
    path: ["projects"],
    what: "list projects",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listProjects(instance, flags),
  },
  {
    path: ["projects", "ls"],
    what: "list projects",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listProjects(instance, flags),
  },
  {
    path: ["projects", "list"],
    what: "list projects",
    takes: ["url", "owner"],
    run: ({ instance, flags }) => listProjects(instance, flags),
  },
  {
    path: ["projects", "get"],
    what: "view project details",
    args: [{ name: "slug", required: true, what: "project slug or [owner]/[project]" }],
    takes: ["url"],
    run: ({ instance, args, flags }) => getProject(instance, args.slug!, flags),
  },
  {
    path: ["projects", "new"],
    what: "create a new project",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newProject(instance, args.name!, flags),
  },
  {
    path: ["projects", "create"],
    what: "create a new project",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url", "owner", "description"],
    run: ({ instance, args, flags }) => newProject(instance, args.name!, flags),
  },
  {
    path: ["projects", "update"],
    what: "update project settings and description",
    args: [{ name: "slug", required: true, what: "project slug or [owner]/[project]" }],
    takes: ["url", "name", "description"],
    run: ({ instance, args, flags }) => updateProject(instance, args.slug!, flags),
  },
  {
    path: ["projects", "delete"],
    what: "delete a project",
    args: [{ name: "slug", required: true, what: "project slug or [owner]/[project]" }],
    takes: ["url"],
    run: ({ instance, args }) => deleteProject(instance, args.slug!),
  },
  {
    path: ["projects", "transfer"],
    what: "transfer project ownership to another user or organization",
    args: [{ name: "slug", required: true, what: "project slug or [owner]/[project]" }],
    takes: ["url", "to", "owner"],
    run: ({ instance, args, flags }) => transferProject(instance, args.slug!, flags),
  },
  {
    path: ["projects", "use"],
    what: "work on this project from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useProject(instance, args.slug!),
  },
  {
    path: ["projects", "switch"],
    what: "work on this project from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useProject(instance, args.slug!),
  },

  // ── Collaborators Resource ─────────────────────────────────────────────
  {
    path: ["collaborators"],
    what: "list project collaborators and pending invitations",
    args: [{ name: "project", required: false, what: "optional project namespace" }],
    takes: ["url", "project", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.project, flags),
  },
  {
    path: ["collaborators", "list"],
    what: "list project collaborators and pending invitations",
    args: [{ name: "project", required: false, what: "optional project namespace" }],
    takes: ["url", "project", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.project, flags),
  },
  {
    path: ["collaborators", "ls"],
    what: "list project collaborators and pending invitations",
    args: [{ name: "project", required: false, what: "optional project namespace" }],
    takes: ["url", "project", "role"],
    run: ({ instance, args, flags }) => listCollaborators(instance, args.project, flags),
  },
  {
    path: ["collaborators", "invite"],
    what: "invite a collaborator to the project",
    args: [{ name: "email", required: true, what: "collaborator email" }],
    takes: ["url", "project", "role"],
    run: ({ instance, args, flags }) => inviteCollaborator(instance, args.email!, flags),
  },
  {
    path: ["collaborators", "update-role"],
    what: "update a collaborator's access role",
    args: [{ name: "user", required: true, what: "collaborator user ID" }],
    takes: ["url", "project", "role"],
    run: ({ instance, args, flags }) => updateCollaboratorRole(instance, args.user!, flags),
  },
  {
    path: ["collaborators", "remove"],
    what: "remove a collaborator from the project",
    args: [{ name: "user", required: true, what: "collaborator user ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => removeCollaborator(instance, args.user!, flags),
  },
  {
    path: ["collaborators", "revoke-invite"],
    what: "revoke a pending project invitation",
    args: [{ name: "invitation", required: true, what: "invitation ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => revokeCollaboratorInvite(instance, args.invitation!, flags),
  },

  // ── Agents Resource ────────────────────────────────────────────────────
  {
    path: ["agents"],
    what: "list agents and access keys",
    takes: ["url", "project"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "ls"],
    what: "list agents and access keys",
    takes: ["url", "project"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "list"],
    what: "list agents and access keys",
    takes: ["url", "project"],
    run: ({ instance, flags }) => listAgents(instance, flags),
  },
  {
    path: ["agents", "get"],
    what: "inspect details of a registered agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => getAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "new"],
    what: "register a new agent in the project",
    args: [{ name: "name", required: true, what: "agent name" }],
    takes: ["url", "project", "description", "type"],
    run: ({ instance, args, flags }) => createAgent(instance, args.name!, flags),
  },
  {
    path: ["agents", "create"],
    what: "register a new agent in the project",
    args: [{ name: "name", required: true, what: "agent name" }],
    takes: ["url", "project", "description", "type"],
    run: ({ instance, args, flags }) => createAgent(instance, args.name!, flags),
  },
  {
    path: ["agents", "update"],
    what: "update a registered agent's settings",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "project", "name", "description", "status"],
    run: ({ instance, args, flags }) => updateAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "delete"],
    what: "delete a registered agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => deleteAgent(instance, args.id!, flags),
  },
  {
    path: ["agents", "key", "create"],
    what: "mint a new API key for an agent",
    args: [{ name: "id", required: true, what: "agent ID" }],
    takes: ["url", "project"],
    run: ({ instance, args, flags }) => createAgentKey(instance, args.id!, flags),
  },
  {
    path: ["agents", "key", "revoke"],
    what: "revoke an agent API key",
    args: [
      { name: "first", required: true, what: "key ID or agent ID" },
      { name: "second", required: false, what: "key ID (when first is agent ID)" },
    ],
    takes: ["url", "project"],
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

  // ── Usage & Telemetry Resource ─────────────────────────────────────────
  {
    path: ["usage"],
    what: "inspect account or organization usage, quotas, and statement breakdowns",
    args: [{ name: "owner", required: false, what: "optional user or org handle" }],
    takes: ["url", "owner", "timeframe"],
    run: ({ instance, args, flags }) => getUsage(instance, args.owner, flags),
  },
  {
    path: ["usage", "get"],
    what: "inspect account or organization usage, quotas, and statement breakdowns",
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
];
