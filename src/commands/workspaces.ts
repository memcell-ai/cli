import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import { get } from "../config.js";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { findWorkspace, saveWorkspace, type Workspace } from "../workspace.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  cmd,
  emit,
  good,
  id as idSeg,
  label,
  place,
  row,
  say,
  value,
  variant,
  warn,
} from "../ui.js";

interface Me {
  activeWorkspace?: { slug: string; name: string } | null;
  workspaces?: { id: string; slug: string; name: string }[];
}

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

function getWorkspacesClient(sdk: any) {
  return sdk.workspaces;
}

export async function listWorkspaces(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const owner = typeof flags.owner === "string" ? flags.owner : undefined;

    const [me, res] = await Promise.all([
      call<Me>(instance, "/api/v1/me").catch(() => null),
      (owner ? wsClient.listForOwner(owner) : wsClient.list()).catch(() => null),
    ]);

    const workspaces: any[] = res?.items || me?.workspaces || [];

    if (workspaces.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(
          1,
          [label("no workspaces")],
          [label("make one with"), cmd("memcell workspace new <name>")],
        ),
      );
      return 0;
    }

    const here = (await findWorkspace())?.workspace;
    const linkedSlug = here?.workspace;
    const activeSlug = linkedSlug || me?.activeWorkspace?.slug;

    say(
      row(0, [badge("memcell"), place(instance)], [variant(`${workspaces.length}`)]),
      ...workspaces.map((w: any) => {
        const isLinked = w.slug === linkedSlug;
        const isActive = w.slug === activeSlug;
        return row(
          1,
          [isActive ? good(w.slug) : value(w.slug)],
          [label(w.name)],
          isActive && [variant("active")],
          isLinked && [variant("linked here")],
        );
      }),
      row(2, [label("work on one with"), cmd("memcell workspace use <slug>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function newWorkspace(
  instance: string,
  name: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const activeOrg = (await get("organization"))?.value as string | undefined;
    const owner = typeof flags.owner === "string" ? flags.owner : activeOrg;
    const description = typeof flags.description === "string" ? flags.description : undefined;

    const created = await wsClient.create({
      name,
      ...(owner ? { owner } : {}),
      ...(description ? { description } : {}),
    });

    const slug = created.slug || name;
    const wsName = created.name || name;

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("made")], [value(slug)], [label(wsName)]),
      row(2, [label("empty until something files into it")]),
      row(2, [label("make it active with"), cmd(`memcell workspace use ${slug}`)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getWorkspace(
  instance: string,
  targetSlug: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const namespace = await resolveNamespace(sdk, targetSlug);
    const workspace = await wsClient.get(namespace);

    say(
      row(0, [badge("memcell"), label("workspace"), place(namespace)]),
      row(1, [good(workspace.name)], [label(`(${workspace.slug})`)]),
      workspace.description ? row(2, [label(workspace.description)]) : null,
      workspace.id ? row(2, [idSeg(workspace.id)]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateWorkspace(
  instance: string,
  targetSlug: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const namespace = await resolveNamespace(sdk, targetSlug);
    const name = typeof flags.name === "string" ? flags.name : undefined;
    const description = typeof flags.description === "string" ? flags.description : undefined;

    const updated = await wsClient.update(namespace, {
      name,
      description,
    });

    say(
      row(0, [badge("memcell"), label("workspace update"), place(namespace)]),
      row(1, [good("updated")], [value(updated.name)], [label(updated.slug)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteWorkspace(instance: string, targetSlug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const namespace = await resolveNamespace(sdk, targetSlug);
    await wsClient.delete(namespace);

    say(
      row(0, [badge("memcell"), label("workspace delete"), place(namespace)]),
      row(1, [good("deleted workspace")], [value(namespace)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function transferWorkspace(
  instance: string,
  targetSlug: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const to = typeof flags.to === "string" ? flags.to : (flags.owner as string | undefined);
  if (!to) {
    say(row(0, [bad("missing target owner")], [label("specify --to <new-owner>")]));
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const wsClient = getWorkspacesClient(sdk);
    const namespace = await resolveNamespace(sdk, targetSlug);
    await wsClient.transfer(namespace, { targetOwner: to });

    say(
      row(0, [badge("memcell"), label("workspace transfer"), place(namespace)]),
      row(1, [good("transferred ownership to")], [value(to)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function useWorkspace(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    let wsMeta: any = null;
    try {
      wsMeta = await sdk.workspaces.get(slug);
    } catch {
      // Direct get fallback
    }

    const answer = await call<{
      activeWorkspace?: { id?: string; slug: string; name?: string; owner?: string };
    }>(instance, "/api/v1/me", {
      method: "PATCH",
      body: { workspace: slug },
    }).catch(() => null);

    const rawWs = wsMeta as any;
    const resolvedFromWs = rawWs?.slug
      ? rawWs
      : rawWs?.workspace?.slug
        ? rawWs.workspace
        : undefined;

    const rawAns = answer as any;
    const resolvedFromAns = rawAns?.slug
      ? rawAns
      : rawAns?.activeWorkspace?.slug
        ? rawAns.activeWorkspace
        : undefined;

    const active = resolvedFromWs || resolvedFromAns || { slug, name: slug };
    const activeSlug = active.slug || slug;
    const activeName = active.name || activeSlug;
    const found = await findWorkspace();

    const targetRoot = found?.root ?? process.cwd();
    const existingWs = found?.workspace;
    const updatedWs: Workspace = {
      instance,
      owner: (active as any).owner || existingWs?.owner,
      workspace: activeSlug,
      workspaceId: (active as any).id || existingWs?.workspaceId,
      project: activeSlug,
      projectId: (active as any).id || existingWs?.projectId,
      space: activeSlug,
      spaceId: (active as any).id || existingWs?.spaceId,
      ...(typeof existingWs?.paused === "boolean" ? { paused: existingWs.paused } : {}),
    };

    const configPath = await saveWorkspace(updatedWs, found?.at ?? targetRoot);

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("working on")], [value(activeName)], [label(activeSlug)]),
      row(2, [place(configPath)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getWorkspaceActivity(
  instance: string,
  targetSlug?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(
      sdk,
      targetSlug || (flags.workspace as string) || (flags.project as string),
    );

    const page = typeof flags.page === "string" ? parseInt(flags.page, 10) : 1;
    const perPage = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 25;
    const outcome = typeof flags.outcome === "string" ? (flags.outcome as any) : undefined;
    const subject = typeof flags.subject === "string" ? flags.subject : undefined;
    const memoryId = typeof flags["memory-id"] === "string" ? flags["memory-id"] : undefined;

    const res = await sdk.workspaces.activity(namespace, {
      page,
      perPage,
      outcome,
      subject,
      memoryId,
    });

    if (flags.json === true) {
      emit(JSON.stringify(res, null, 2) + "\n");
      return 0;
    }

    const items = res.items || [];
    if (items.length === 0) {
      say(
        row(0, [badge("memcell"), label("workspace activity"), place(namespace)]),
        row(1, [label("no activity recorded in this workspace")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("workspace activity"), place(namespace)],
        [variant(`${items.length} event${items.length === 1 ? "" : "s"}`)],
      ),
      ...items.map((ev: any) =>
        row(
          1,
          [
            ev.outcome === "worked"
              ? good("worked")
              : ev.outcome === "failed"
                ? bad("failed")
                : variant(ev.outcome || "event"),
          ],
          ev.subject ? [label("subject:"), value(ev.subject)] : null,
          ev.memoryId ? [label("memory:"), idSeg(ev.memoryId)] : null,
          ev.note ? [label(ev.note)] : null,
          ev.timestamp ? [variant(new Date(ev.timestamp).toLocaleTimeString())] : null,
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
