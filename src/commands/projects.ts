import { call, MemcellError } from "../client.js";
import { get } from "../config.js";
import { credentialFor } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, good, label, place, row, say, value, variant, warn } from "../ui.js";

// Projects, and which one you are working on.
//
// `use` writes the active project preference on the user profile held by
// the instance and read by every surface — so the terminal and the browser
// agree on where statements land.
//
// A wired directory stays anchored: `connect` records its project, and a
// directory files where it was wired regardless of what anybody switched to
// since.

interface Me {
  activeProject?: { slug: string; name: string } | null;
  activeSpace?: { slug: string; name: string } | null;
  projects?: { id: string; slug: string; name: string }[];
}

interface ProjectListResponse {
  projects: { id: string; slug: string; name: string }[];
}

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

export async function listProjects(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const [me, direct] = await Promise.all([
      call<Me>(instance, "/api/v1/me").catch(() => null),
      call<ProjectListResponse>(instance, "/api/v1/projects").catch(() => null),
    ]);

    const active = me?.activeProject || me?.activeSpace;
    const projects = direct?.projects || me?.projects || [];

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
    return refused(instance, error as MemcellError);
  }
}

export async function newProject(instance: string, name: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const activeOrg = (await get("organization"))?.value as string | undefined;
    const body: Record<string, unknown> = { name };
    if (activeOrg) {
      body.owner = activeOrg;
    }

    const created = await call<{
      project?: { slug: string; name?: string };
      slug?: string;
      name?: string;
    }>(instance, "/api/v1/projects", {
      method: "POST",
      body,
    });
    const proj = created.project ?? created;
    const slug = proj.slug || name;
    const projName = proj.name || name;

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("made")], [value(slug)], [label(projName)]),
      row(2, [label("empty until something files into it")]),
      row(2, [label("make it active with"), cmd(`memcell projects use ${slug}`)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
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
    return refused(instance, error as MemcellError);
  }
}

function refused(instance: string, failure: MemcellError): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}
