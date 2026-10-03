import { call } from "./client.js";
import { get } from "./config.js";
import { credentialFor } from "./instance.js";
import type { Command, ResolvedContext, ResolvedProject } from "./model.js";
import { findProject } from "./project.js";
import { badge, cmd, label, place, row, say, warn } from "./ui.js";

interface MeResponse {
  user?: { id: string; name?: string; handle?: string };
  activeWorkspace?: { id?: string; slug: string; name?: string; owner?: string } | null;
  activeProject?: { id?: string; slug: string; name?: string; owner?: string } | null;
  activeSpace?: { id?: string; slug: string; name?: string; owner?: string } | null;
  activeOrganization?: { id?: string; slug: string; name?: string } | null;
}

/**
 * Resolves unified execution context across the 4-tier hierarchy:
 * 1. Explicit CLI flags (--workspace, --project, --owner)
 * 2. Local directory project file (.memcell / findProject())
 * 3. Active CLI config (memcell config get project / workspace / organization)
 * 4. User session profile & active project/workspace from instance
 */
export async function resolveContext(
  instance: string,
  flags: Record<string, string | true> = {},
  from?: string,
): Promise<ResolvedContext> {
  const credential = await credentialFor(instance).catch(() => null);

  // 1. Check explicit flags
  const flagProject =
    (typeof flags.workspace === "string" ? flags.workspace.trim() : undefined) ??
    (typeof flags.project === "string" ? flags.project.trim() : undefined);
  const flagOwner = typeof flags.owner === "string" ? flags.owner.trim() : undefined;

  let owner: string | null = flagOwner ?? null;
  let project: ResolvedProject | null = null;

  if (flagProject) {
    if (flagProject.includes("/")) {
      const [ownerPart, slugPart] = flagProject.split("/", 2);
      const effectiveOwner = flagOwner || ownerPart;
      project = {
        owner: effectiveOwner,
        project: slugPart!,
        workspace: slugPart!,
        namespace: `${effectiveOwner}/${slugPart}`,
        source: "flag",
      };
      owner = effectiveOwner ?? null;
    } else {
      project = {
        owner: flagOwner,
        project: flagProject,
        workspace: flagProject,
        namespace: flagOwner ? `${flagOwner}/${flagProject}` : flagProject,
        source: "flag",
      };
    }
  }

  // 2. Fall back to local project file (.memcell)
  if (!project) {
    const found = await findProject(from).catch(() => null);
    if (found?.project) {
      const proj = found.project;
      const slug = proj.project || proj.space;
      const effectiveOwner = flagOwner || proj.owner;
      project = {
        owner: effectiveOwner,
        project: slug,
        workspace: slug,
        namespace: effectiveOwner ? `${effectiveOwner}/${slug}` : slug,
        projectId: proj.projectId || proj.spaceId,
        workspaceId: proj.projectId || proj.spaceId,
        at: found.at,
        source: "file",
      };
      if (!owner && effectiveOwner) owner = effectiveOwner;
    }
  }

  // 3. Fall back to active CLI config
  if (!project) {
    const configuredProject =
      ((await get("workspace").catch(() => null))?.value as string | undefined) ??
      ((await get("project").catch(() => null))?.value as string | undefined);
    const configuredOrg = (await get("organization").catch(() => null))?.value as
      string | undefined;
    if (configuredProject) {
      const effectiveOwner = flagOwner || configuredOrg;
      project = {
        owner: effectiveOwner,
        project: configuredProject,
        workspace: configuredProject,
        namespace: effectiveOwner ? `${effectiveOwner}/${configuredProject}` : configuredProject,
        source: "config",
      };
      if (!owner && effectiveOwner) owner = effectiveOwner;
    }
  }

  // 4. Resolve owner or active project from session if logged in
  if (credential && (!owner || !project)) {
    try {
      const me = await call<MeResponse>(instance, "/api/v1/me", { bearer: credential.token });
      const activeProj = me.activeWorkspace || me.activeProject || me.activeSpace;
      const userHandle = me.user?.handle || me.user?.name;
      const activeOrg = me.activeOrganization?.slug;

      if (!owner) {
        owner = activeOrg || userHandle || null;
      }

      if (!project && activeProj) {
        const effectiveOwner = flagOwner || activeProj.owner || owner || undefined;
        project = {
          owner: effectiveOwner,
          project: activeProj.slug,
          workspace: activeProj.slug,
          namespace: effectiveOwner ? `${effectiveOwner}/${activeProj.slug}` : activeProj.slug,
          projectId: activeProj.id,
          workspaceId: activeProj.id,
          source: "active",
        };
      }
    } catch {
      // Best-effort session enrichment
    }
  }

  return {
    instance,
    from: from ?? process.cwd(),
    credential,
    project,
    workspace: project,
    owner,
  };
}

/**
 * Enforces declarative command aspect requirements before handler execution.
 */
export function enforceRequirements(
  command: Command,
  context: ResolvedContext,
): { ok: true } | { ok: false; exitCode: number } {
  // 1. Auth requirement gate
  if (command.require?.auth === "required" && !context.credential) {
    say(
      row(0, [badge("memcell"), place(context.instance)]),
      row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
    );
    return { ok: false, exitCode: 1 };
  }

  // 2. Project / Workspace requirement gate
  const requiresProject =
    command.require?.workspace === "required" || command.require?.project === "required";
  if (requiresProject && !context.project) {
    say(
      row(0, [badge("memcell"), label(command.path.join(" "))]),
      row(1, [warn("no project specified")]),
      row(2, [label("pass"), cmd("--project <slug>"), label("or run"), cmd("memcell connect")]),
    );
    return { ok: false, exitCode: 1 };
  }

  return { ok: true };
}
