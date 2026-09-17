import { call, MemcellError } from "../client.js";
import { get, set } from "../config.js";
import { credentialFor } from "../instance.js";
import { badge, cmd, good, label, place, row, say, value, variant, warn } from "../ui.js";

interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface OrganizationListResponse {
  ok: boolean;
  organizations: OrganizationItem[];
}

interface CreateOrganizationResponse {
  ok: boolean;
  organization: OrganizationItem;
}

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

export async function listOrganizations(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const res = await call<OrganizationListResponse>(instance, "/api/v1/organizations");
    const organizations = res.organizations || [];

    const active = (await get("organization"))?.value as string | undefined;

    if (organizations.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [label("no organizations")]),
        row(2, [label("make one with"), cmd("memcell orgs create <slug> --name <name>")]),
      );
      return 0;
    }

    say(
      row(0, [badge("memcell"), place(instance)], [variant(`${organizations.length}`)]),
      ...organizations.map((org) =>
        row(
          1,
          [org.slug === active ? good(org.slug) : value(org.slug)],
          [label(org.name)],
          [variant(org.role)],
          org.slug === active && [variant("active")],
        ),
      ),
      row(2, [label("switch active context with"), cmd("memcell orgs switch <slug>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

export async function createOrganization(
  instance: string,
  slug: string,
  flags: { name?: string },
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const name = flags.name?.trim() || slug;

  try {
    const res = await call<CreateOrganizationResponse>(instance, "/api/v1/organizations", {
      method: "POST",
      body: { slug, name },
    });

    const created = res.organization;
    await set("organization", created.slug || slug, "global");

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(
        1,
        [good("Created organization")],
        [value(created.slug || slug)],
        [label("Active context set.")],
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

export async function switchOrganization(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  if (slug === "personal" || slug === "--personal" || slug === "none" || slug === "clear") {
    await set("organization", "", "global");
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("Switched to personal context.")]),
    );
    return 0;
  }

  try {
    const res = await call<OrganizationListResponse>(instance, "/api/v1/organizations");
    const organizations = res.organizations || [];
    const match = organizations.find(
      (o) => o.slug.toLowerCase() === slug.toLowerCase() || o.id === slug,
    );

    if (!match) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [warn("unknown organization")], [value(slug)]),
        row(2, [label("see your organizations with"), cmd("memcell orgs list")]),
      );
      return 1;
    }

    await set("organization", match.slug, "global");

    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("Active organization set to")], [value(match.slug)], [label(".")]),
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
