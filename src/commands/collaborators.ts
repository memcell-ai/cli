import { MemCellError } from "@memcell/sdk";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
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
  text,
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

export async function listCollaborators(
  instance: string,
  targetWorkspace?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, targetWorkspace || (flags.workspace as string));

    const role = typeof flags.role === "string" ? (flags.role as any) : undefined;
    const res = await sdk.collaborators.list(namespace, { role });

    const members = res.collaborators || [];
    const pending = res.pendingInvitations || [];

    say(
      row(
        0,
        [badge("memcell"), label("collaborator"), place(namespace)],
        [variant(`${members.length} member${members.length === 1 ? "" : "s"}`)],
      ),
      ...members.map((c) =>
        row(
          1,
          [good(c.name || c.email || c.userId)],
          [variant(c.role)],
          c.email ? [label(c.email)] : null,
          [idSeg(c.userId)],
        ),
      ),
      ...(pending.length > 0
        ? [
            row(0, [text("")]),
            row(1, [label("pending invitations:")]),
            ...pending.map((inv) =>
              row(
                2,
                [variant(inv.email)],
                [label("role:"), variant(inv.role)],
                inv.invitedBy?.email ? [label(`by ${inv.invitedBy.email}`)] : null,
                [idSeg(inv.id)],
              ),
            ),
          ]
        : []),
      row(2, [label("invite one with"), cmd("memcell collaborator invite <email> --role <role>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function inviteCollaborator(
  instance: string,
  email: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const role = typeof flags.role === "string" ? (flags.role as any) : "read";

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.workspace as string);

    const inv = await sdk.collaborators.invite(namespace, { identifier: email, role });

    say(
      row(0, [badge("memcell"), label("collaborator invite"), place(namespace)]),
      row(1, [good("invited")], [value(email)], [label("as"), variant(role)]),
      row(2, [idSeg(inv.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateCollaboratorRole(
  instance: string,
  userId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const role = typeof flags.role === "string" ? (flags.role as any) : undefined;
  if (!role) {
    say(row(0, [bad("missing role")], [label("specify --role <read|write|admin>")]));
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.workspace as string);

    await sdk.collaborators.updateRole(namespace, userId, role);

    say(
      row(0, [badge("memcell"), label("collaborator update-role"), place(namespace)]),
      row(1, [good("updated role")], [value(userId)], [label("to"), variant(role)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function removeCollaborator(
  instance: string,
  userId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.workspace as string);

    await sdk.collaborators.remove(namespace, userId);

    say(
      row(0, [badge("memcell"), label("collaborator remove"), place(namespace)]),
      row(1, [good("removed")], [value(userId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function revokeCollaboratorInvite(
  instance: string,
  invitationId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.workspace as string);

    await sdk.collaborators.revokeInvitation(namespace, invitationId);

    say(
      row(0, [badge("memcell"), label("collaborator revoke-invite"), place(namespace)]),
      row(1, [good("revoked invitation")], [idSeg(invitationId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
