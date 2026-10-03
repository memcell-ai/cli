import { MemCellError } from "@memcell/sdk";
import { call, MemcellError } from "../client.js";
import { get } from "../config.js";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { findProject } from "../project.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  cmd,
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
  activeProject?: { slug: string; name: string } | null;
  activeSpace?: { slug: string; name: string } | null;
  workspaces?: { id: string; slug: string; name: string }[];
  projects?: { id: string; slug: string; name: string }[];
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
  return sdk.workspaces ?? sdk.projects;
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

    const active = me?.activeWorkspace || me?.activeProject || me?.activeSpace;
    const workspaces: any[] = res?.items || me?.workspaces || me?.projects || [];

    if (workspaces.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(
          1,
          [label("no workspaces")],
          [label("make one with"), cmd("memcell workspaces new <name>")],
        ),
      );
      return 0;
    }

    const here = (await findProject())?.project;
    const linkedSlug = here?.project || here?.space;

    say(
      row(0, [badge("memcell"), place(instance)], [variant(`${workspaces.length}`)]),
      ...workspaces.map((w: any) =>
        row(
          1,
          [w.slug === active?.slug ? good(w.slug) : value(w.slug)],
          [label(w.name)],
          w.slug === active?.slug && [variant("active")],
          w.slug === linkedSlug && [variant("linked here")],
        ),
      ),
      row(2, [label("work on one with"), cmd("memcell workspaces use <slug>")]),
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
      row(2, [label("make it active with"), cmd(`memcell workspaces use ${slug}`)]),
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
      row(0, [badge("memcell"), label("workspaces update"), place(namespace)]),
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
      row(0, [badge("memcell"), label("workspaces delete"), place(namespace)]),
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
      row(0, [badge("memcell"), label("workspaces transfer"), place(namespace)]),
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
    const answer = await call<{
      activeWorkspace?: { slug: string; name: string };
      activeProject?: { slug: string; name: string };
      activeSpace?: { slug: string; name: string };
    }>(instance, "/api/v1/me", {
      method: "PATCH",
      body: { workspace: slug, project: slug },
    });

    const active = answer.activeWorkspace ||
      answer.activeProject ||
      answer.activeSpace || { slug, name: slug };
    const here = (await findProject())?.project;
    const linkedSlug = here?.project || here?.space;

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("working on")], [value(active.name)], [label(active.slug)]),
      here && linkedSlug !== active.slug
        ? row(
            2,
            [label("this directory stays connected to"), value(linkedSlug || "")],
            [label("reconnect it with"), cmd("memcell connect")],
          )
        : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
