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
  activeProject?: { slug: string; name: string } | null;
  activeSpace?: { slug: string; name: string } | null;
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

export async function listProjects(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const owner = typeof flags.owner === "string" ? flags.owner : undefined;

    const [me, res] = await Promise.all([
      call<Me>(instance, "/api/v1/me").catch(() => null),
      (owner ? sdk.projects.listForOwner(owner) : sdk.projects.list()).catch(() => null),
    ]);

    const active = me?.activeProject || me?.activeSpace;
    const projects = res?.items || me?.projects || [];

    if (projects.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(
          1,
          [label("no projects")],
          [label("make one with"), cmd("memcell projects new <name>")],
        ),
      );
      return 0;
    }

    const here = (await findProject())?.project;
    const linkedSlug = here?.project || here?.space;

    say(
      row(0, [badge("memcell"), place(instance)], [variant(`${projects.length}`)]),
      ...projects.map((p) =>
        row(
          1,
          [p.slug === active?.slug ? good(p.slug) : value(p.slug)],
          [label(p.name)],
          p.slug === active?.slug && [variant("active")],
          p.slug === linkedSlug && [variant("linked here")],
        ),
      ),
      row(2, [label("work on one with"), cmd("memcell projects use <slug>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function newProject(
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
    const activeOrg = (await get("organization"))?.value as string | undefined;
    const owner = typeof flags.owner === "string" ? flags.owner : activeOrg;
    const description = typeof flags.description === "string" ? flags.description : undefined;

    const created = await sdk.projects.create({
      name,
      ...(owner ? { owner } : {}),
      ...(description ? { description } : {}),
    });

    const slug = created.slug || name;
    const projName = created.name || name;

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("made")], [value(slug)], [label(projName)]),
      row(2, [label("empty until something files into it")]),
      row(2, [label("make it active with"), cmd(`memcell projects use ${slug}`)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getProject(
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
    const namespace = await resolveNamespace(sdk, targetSlug);
    const project = await sdk.projects.get(namespace);

    say(
      row(0, [badge("memcell"), label("project"), place(namespace)]),
      row(1, [good(project.name)], [label(`(${project.slug})`)]),
      project.description ? row(2, [label(project.description)]) : null,
      project.id ? row(2, [idSeg(project.id)]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateProject(
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
    const namespace = await resolveNamespace(sdk, targetSlug);
    const name = typeof flags.name === "string" ? flags.name : undefined;
    const description = typeof flags.description === "string" ? flags.description : undefined;

    const updated = await sdk.projects.update(namespace, {
      name,
      description,
    });

    say(
      row(0, [badge("memcell"), label("projects update"), place(namespace)]),
      row(1, [good("updated")], [value(updated.name)], [label(updated.slug)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteProject(instance: string, targetSlug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, targetSlug);
    await sdk.projects.delete(namespace);

    say(
      row(0, [badge("memcell"), label("projects delete"), place(namespace)]),
      row(1, [good("deleted project")], [value(namespace)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function transferProject(
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
    const namespace = await resolveNamespace(sdk, targetSlug);
    await sdk.projects.transfer(namespace, { targetOwner: to });

    say(
      row(0, [badge("memcell"), label("projects transfer"), place(namespace)]),
      row(1, [good("transferred ownership to")], [value(to)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function useProject(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const answer = await call<{
      activeProject?: { slug: string; name: string };
      activeSpace?: { slug: string; name: string };
    }>(instance, "/api/v1/me", {
      method: "PATCH",
      body: { project: slug },
    });

    const active = answer.activeProject || answer.activeSpace || { slug, name: slug };
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
