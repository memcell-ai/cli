import { call } from "../client.js";
import { get } from "../config.js";
import { credentialFor } from "../instance.js";
import {
  bad,
  badge,
  cmd,
  emit,
  good,
  id as idSeg,
  label,
  place,
  row,
  say,
  time,
  value,
  variant,
  warn,
} from "../ui.js";

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

export async function resolveOrg(
  flags?: Record<string, string | true>,
): Promise<string | undefined> {
  if (typeof flags?.org === "string" && flags.org.trim()) {
    return flags.org.trim();
  }
  if (typeof flags?.organization === "string" && flags.organization.trim()) {
    return flags.organization.trim();
  }
  const configOrg = (await get("organization"))?.value as string | undefined;
  return configOrg?.trim() || undefined;
}

function missingOrg(instance: string): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(
      1,
      [warn("organization required")],
      [label("specify --org <slug> or set active org with"), cmd("memcell orgs use <slug>")],
    ),
  );
  return 1;
}

export async function listFleet(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const query = new URLSearchParams();
    if (typeof flags.scope === "string") query.set("scope", flags.scope.trim());
    if (typeof flags.status === "string") query.set("status", flags.status.trim());
    if (typeof flags.health === "string") query.set("health", flags.health.trim());
    if (typeof flags.team === "string") query.set("teamId", flags.team.trim());
    if (typeof flags.workspace === "string") query.set("workspaceId", flags.workspace.trim());
    else if (typeof flags.project === "string") query.set("workspaceId", flags.project.trim());
    const qs = query.toString() ? `?${query.toString()}` : "";

    const res = await call<{ agents: any[] }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet${qs}`,
    );
    const agents = res.agents || [];

    if (flags.json === true) {
      emit(JSON.stringify(agents, null, 2) + "\n");
      return 0;
    }

    if (agents.length === 0) {
      say(
        row(0, [badge("memcell"), label("fleet"), value(orgSlug), place(instance)]),
        row(1, [label("no agents in fleet")]),
        row(2, [
          label("register an agent with"),
          cmd("memcell fleet register <name> --org <slug>"),
        ]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("fleet"), value(orgSlug), place(instance)],
        [variant(`${agents.length} agents`)],
      ),
      ...agents.map((ag) => {
        const isSuspended = ag.status === "suspended";
        const statusBadge = isSuspended ? bad("SUSPENDED") : good("ACTIVE");
        const healthBadge = ag.health === "healthy" ? good("healthy") : warn(ag.health);
        const scopeStr = ag.scope === "organization" ? "org-wide" : "workspace-scoped";

        return row(
          1,
          [idSeg(ag.id)],
          [value(ag.name)],
          [variant(`@${ag.slug}`)],
          [statusBadge],
          [healthBadge],
          [label(scopeStr)],
          ag.framework ? [label(ag.framework)] : [],
          ag.model ? [variant(ag.model)] : [],
          [label(`${ag.activeKeyCount ?? 0} keys`)],
          [label(`${ag.workspaceGrantCount ?? ag.projectGrantCount ?? 0} grants`)],
        );
      }),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function getFleetAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const detail = await call<{ agent: any; keys?: any[]; grants?: any[] }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet/${encodeURIComponent(agentId)}`,
    );

    if (flags.json === true) {
      emit(JSON.stringify(detail, null, 2) + "\n");
      return 0;
    }

    const agent = detail.agent;
    const keys = detail.keys || [];
    const grants = detail.grants || [];
    const isSuspended = agent.status === "suspended";

    say(
      row(0, [badge("memcell"), label("fleet agent"), value(agent.name), place(instance)]),
      row(
        1,
        [idSeg(agent.id)],
        [label("slug:"), value(agent.slug)],
        [label("status:")],
        [isSuspended ? bad("SUSPENDED") : good("ACTIVE")],
        [label("health:")],
        [agent.health === "healthy" ? good("healthy") : warn(agent.health)],
      ),
      row(
        1,
        [label("scope:")],
        [value(agent.scope)],
        agent.teamName ? [label("team:"), value(agent.teamName)] : [],
        agent.workspaceName || agent.projectName
          ? [label("workspace:"), value(agent.workspaceName || agent.projectName)]
          : [],
      ),
      agent.framework || agent.model
        ? row(
            1,
            agent.framework ? [label("framework:"), value(agent.framework)] : [],
            agent.model ? [label("model:"), variant(agent.model)] : [],
          )
        : row(1, []),
      agent.description ? row(1, [label("description:"), value(agent.description)]) : row(1, []),
      isSuspended
        ? row(
            1,
            [bad("KILL-SWITCH ACTIVE:")],
            [label("reason:"), warn(agent.suspensionReason ?? "manual")],
            agent.suspendedAt ? [time(String(agent.suspendedAt))] : [],
          )
        : row(1, []),
    );

    if (keys.length > 0) {
      say(
        row(1, [label("Active Credentials:"), variant(`${keys.length}`)]),
        ...keys.map((k) =>
          row(
            2,
            [idSeg(k.id)],
            [label("prefix:"), value(k.keyPrefix)],
            k.name ? [label(k.name)] : [],
            k.lastUsedAt
              ? [label("last used:"), time(String(k.lastUsedAt))]
              : [label("never used")],
          ),
        ),
      );
    }

    if (grants.length > 0) {
      say(
        row(1, [label("Cross-Workspace Grants:"), variant(`${grants.length}`)]),
        ...grants.map((g) =>
          row(
            2,
            [idSeg(g.workspaceId || g.projectId)],
            [value(g.workspaceName || g.projectName || g.workspaceId || g.projectId)],
            [variant(g.permission)],
            [time(String(g.grantedAt))],
          ),
        ),
      );
    }

    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function registerFleetAgent(
  instance: string,
  name: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const slug = typeof flags.slug === "string" ? flags.slug.trim() : undefined;
    const scope = typeof flags.scope === "string" ? flags.scope.trim() : "organization";
    const framework = typeof flags.framework === "string" ? flags.framework.trim() : undefined;
    const model = typeof flags.model === "string" ? flags.model.trim() : undefined;
    const description =
      typeof flags.description === "string" ? flags.description.trim() : undefined;
    const teamId = typeof flags.team === "string" ? flags.team.trim() : undefined;
    const workspaceId =
      typeof flags.workspace === "string"
        ? flags.workspace.trim()
        : typeof flags.project === "string"
          ? flags.project.trim()
          : undefined;

    const result = await call<{ agent: any; key?: any }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet`,
      {
        method: "POST",
        body: {
          name,
          slug,
          scope,
          framework,
          model,
          description,
          teamId,
          workspaceId,
          projectId: workspaceId,
          generateKey: flags["no-key"] !== true,
        },
      },
    );

    if (flags.json === true) {
      emit(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    const { agent, key } = result;

    say(
      row(0, [badge("memcell"), label("fleet agent registered"), place(instance)]),
      row(
        1,
        [good("registered agent")],
        [idSeg(agent.id)],
        [value(agent.name)],
        [variant(`@${agent.slug}`)],
      ),
      row(1, [label("scope:")], [value(agent.scope)], [label("status:")], [good(agent.status)]),
    );

    if (key) {
      say(
        row(1, [warn("API KEY CREATED:")]),
        row(2, [value(key.key)]),
        row(2, [label("prefix:"), value(key.keyPrefix)], [label("id:"), idSeg(key.keyId)]),
        row(2, [warn("Save this key securely now. You will not be able to see it again.")]),
      );
    }

    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function suspendFleetAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const reason = typeof flags.reason === "string" ? flags.reason.trim() : undefined;
  if (!reason) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("kill-switch requires --reason <explanation>")]),
    );
    return 1;
  }

  try {
    const result = await call<{ ok: boolean; agent: any }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet/${encodeURIComponent(agentId)}/suspend`,
      {
        method: "POST",
        body: { reason },
      },
    );

    say(
      row(0, [badge("memcell"), label("fleet kill-switch"), place(instance)]),
      row(1, [bad("AGENT SUSPENDED")], [idSeg(result.agent.id)], [value(result.agent.name)]),
      row(2, [label("reason:")], [warn(reason)]),
      row(2, [
        good("Gateway access instantly blocked across all API doors (403 agent_suspended)."),
      ]),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function resumeFleetAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const result = await call<{ ok: boolean; agent: any }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet/${encodeURIComponent(agentId)}/resume`,
      {
        method: "POST",
      },
    );

    say(
      row(0, [badge("memcell"), label("fleet agent"), place(instance)]),
      row(1, [good("AGENT REACTIVATED")], [idSeg(result.agent.id)], [value(result.agent.name)]),
      row(2, [label("Gateway access restored for valid agent API keys.")]),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export async function grantFleetWorkspace(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const workspaceId =
    typeof flags.workspace === "string"
      ? flags.workspace.trim()
      : typeof flags.project === "string"
        ? flags.project.trim()
        : undefined;
  if (!workspaceId) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("--workspace <workspaceId> is required to grant workspace access")]),
    );
    return 1;
  }

  const permission =
    typeof flags.permission === "string" &&
    ["read", "write", "admin"].includes(flags.permission.trim())
      ? flags.permission.trim()
      : "read";

  try {
    await call<{ ok: boolean; grant: any }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet/${encodeURIComponent(agentId)}/grant`,
      {
        method: "POST",
        body: { workspaceId, projectId: workspaceId, permission },
      },
    );

    say(
      row(0, [badge("memcell"), label("fleet workspace grant"), place(instance)]),
      row(
        1,
        [good("granted access")],
        [idSeg(agentId)],
        [label("to workspace")],
        [value(workspaceId)],
        [variant(permission)],
      ),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export const grantFleetProject = grantFleetWorkspace;

export async function revokeFleetWorkspace(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const workspaceId =
    typeof flags.workspace === "string"
      ? flags.workspace.trim()
      : typeof flags.project === "string"
        ? flags.project.trim()
        : undefined;
  if (!workspaceId) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("--workspace <workspaceId> is required to revoke workspace access")]),
    );
    return 1;
  }

  try {
    await call<{ ok: boolean }>(
      instance,
      `/api/v1/organizations/${encodeURIComponent(orgSlug)}/fleet/${encodeURIComponent(agentId)}/grant`,
      {
        method: "DELETE",
        body: { workspaceId, projectId: workspaceId },
      },
    );

    say(
      row(0, [badge("memcell"), label("fleet workspace grant revoked"), place(instance)]),
      row(
        1,
        [good("revoked access")],
        [idSeg(agentId)],
        [label("from workspace")],
        [value(workspaceId)],
      ),
    );
    return 0;
  } catch (err) {
    return refused(instance, err as Error);
  }
}

export const revokeFleetProject = revokeFleetWorkspace;
