import { MemCellError } from "@memcell/sdk";
import { get, set } from "../config.js";
import { credentialFor } from "../instance.js";
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

export async function listOrganizations(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const organizations = await sdk.organizations.list();

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
          org.role ? [variant(org.role)] : null,
          org.slug === active && [variant("active")],
        ),
      ),
      row(2, [label("switch active context with"), cmd("memcell orgs switch <slug>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createOrganization(
  instance: string,
  slug: string,
  flags: { name?: string } = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const name = flags.name?.trim() || slug;

  try {
    const sdk = await getSdkClient(instance);
    const created = await sdk.organizations.create({ slug, name });

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
    return refused(instance, error as Error);
  }
}

export async function getOrganization(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const org = await sdk.organizations.get(slug);

    say(
      row(0, [badge("memcell"), label("organization"), place(instance)]),
      row(1, [good(org.name)], [value(org.slug)], org.role ? [variant(org.role)] : null),
      org.id ? row(2, [idSeg(org.id)]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateOrganization(
  instance: string,
  slug: string,
  flags: { name?: string } = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const name = flags.name?.trim();
    const updated = await sdk.organizations.update(slug, { name });

    say(
      row(0, [badge("memcell"), label("orgs update"), place(instance)]),
      row(1, [good("updated")], [value(updated.slug)], [label(updated.name)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteOrganization(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    await sdk.organizations.delete(slug);

    // If active organization was this one, clear it
    const active = (await get("organization"))?.value as string | undefined;
    if (active === slug) {
      await set("organization", "", "global");
    }

    say(
      row(0, [badge("memcell"), label("orgs delete"), place(instance)]),
      row(1, [good("deleted organization")], [value(slug)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listOrgMembers(
  instance: string,
  slug: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const role = typeof flags.role === "string" ? (flags.role as any) : undefined;
    const res = await sdk.organizations.listMembers(slug, { role });
    const members = res.items || [];

    say(
      row(
        0,
        [badge("memcell"), label("org members"), place(slug)],
        [variant(`${members.length} member${members.length === 1 ? "" : "s"}`)],
      ),
      ...members.map((m) =>
        row(
          1,
          [good(m.name || m.email || m.userId)],
          [variant(m.role)],
          m.email ? [label(m.email)] : null,
          [idSeg(m.userId)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateOrgMember(
  instance: string,
  slug: string,
  userId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const role = typeof flags.role === "string" ? (flags.role as any) : undefined;
  if (!role) {
    say(row(0, [bad("missing role")], [label("specify --role <owner|admin|member>")]));
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    await sdk.organizations.updateMemberRole(slug, userId, role);

    say(
      row(0, [badge("memcell"), label("org member update"), place(slug)]),
      row(1, [good("updated member role")], [value(userId)], [label("to"), variant(role)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function removeOrgMember(
  instance: string,
  slug: string,
  userId: string,
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    await sdk.organizations.removeMember(slug, userId);

    say(
      row(0, [badge("memcell"), label("org member remove"), place(slug)]),
      row(1, [good("removed member")], [value(userId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listOrgInvitations(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const invitations = await sdk.organizations.listInvitations(slug);

    say(
      row(
        0,
        [badge("memcell"), label("org invitations"), place(slug)],
        [variant(`${invitations.length}`)],
      ),
      ...invitations.map((inv) =>
        row(
          1,
          [variant(inv.email)],
          [label("role:"), variant(inv.role)],
          inv.expiresAt ? [label("expires:"), time(String(inv.expiresAt))] : null,
          [idSeg(inv.id)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function inviteOrgMember(
  instance: string,
  slug: string,
  email: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const role = typeof flags.role === "string" ? (flags.role as any) : "member";

  try {
    const sdk = await getSdkClient(instance);
    const invitation = await sdk.organizations.inviteMember(slug, { email, role });

    say(
      row(0, [badge("memcell"), label("org invite"), place(slug)]),
      row(1, [good("invited")], [value(email)], [label("as"), variant(role)]),
      row(2, [idSeg(invitation.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function revokeOrgInvitation(
  instance: string,
  slug: string,
  invitationId: string,
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    await sdk.organizations.revokeInvitation(slug, invitationId);

    say(
      row(0, [badge("memcell"), label("org invite revoke"), place(slug)]),
      row(1, [good("revoked invitation")], [idSeg(invitationId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
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
    const sdk = await getSdkClient(instance);
    const organizations = await sdk.organizations.list();
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
    return refused(instance, error as Error);
  }
}
