import { MemCellError } from "@memcell/sdk";
import { credentialFor } from "../instance.js";
import { getSdkClient } from "../sdk-client.js";
import { resolveOrg } from "./fleet.js";
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

function missingOrg(instance: string): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(
      1,
      [warn("organization required")],
      [label("specify --org <slug> or set active org with"), cmd("memcell org use <slug>")],
    ),
  );
  return 1;
}

export async function listTeams(
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
    const sdk = await getSdkClient(instance);
    const teams = await sdk.forOrg(orgSlug).teams.list();

    if (flags.json === true) {
      emit(JSON.stringify(teams, null, 2) + "\n");
      return 0;
    }

    if (teams.length === 0) {
      say(
        row(0, [badge("memcell"), label("team"), place(orgSlug)]),
        row(
          1,
          [label("no teams in organization")],
          [label("create one with"), cmd("memcell team new <name>")],
        ),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("team"), place(orgSlug)],
        [variant(`${teams.length} team${teams.length === 1 ? "" : "s"}`)],
      ),
      ...teams.map((t: any) =>
        row(
          1,
          [good(t.name)],
          [variant(`${t.memberCount} member${t.memberCount === 1 ? "" : "s"}`)],
          [label(`${t.workspaceCount} workspaces`)],
          [label(`${t.agentCount} agents`)],
          [idSeg(t.id)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getTeam(
  instance: string,
  teamId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const sdk = await getSdkClient(instance);
    const detail = await sdk.forOrg(orgSlug).teams.get(teamId);

    if (flags.json === true) {
      emit(JSON.stringify(detail, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("team"), place(orgSlug)], [idSeg(teamId)]),
      row(1, [good(detail.team.name)], [label(`in ${orgSlug}`)]),
      row(
        2,
        [label("workspaces:")],
        detail.workspaces.length > 0
          ? [value(detail.workspaces.map((w: any) => w.slug).join(", "))]
          : [variant("none")],
      ),
      row(
        2,
        [label("agents:")],
        detail.agents.length > 0
          ? [value(detail.agents.map((a: any) => a.name).join(", "))]
          : [variant("none")],
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createTeam(
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
    const sdk = await getSdkClient(instance);
    const team = await sdk.forOrg(orgSlug).teams.create(name);

    if (flags.json === true) {
      emit(JSON.stringify(team, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("team create"), place(orgSlug)]),
      row(1, [good("created team")], [value(team.name)]),
      row(2, [idSeg(team.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateTeam(
  instance: string,
  teamId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const name = typeof flags.name === "string" ? flags.name : undefined;
  if (!name) {
    say(row(0, [bad("missing name")], [label("specify --name <new-name>")]));
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const updated = await sdk.forOrg(orgSlug).teams.update(teamId, name);

    if (flags.json === true) {
      emit(JSON.stringify(updated, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("team update"), place(orgSlug)]),
      row(1, [good("updated team")], [value(updated.name)]),
      row(2, [idSeg(updated.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteTeam(
  instance: string,
  teamId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const sdk = await getSdkClient(instance);
    await sdk.forOrg(orgSlug).teams.delete(teamId);

    say(
      row(0, [badge("memcell"), label("team delete"), place(orgSlug)]),
      row(1, [good("deleted team")], [idSeg(teamId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listTeamMembers(
  instance: string,
  teamId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const sdk = await getSdkClient(instance);
    const members = await sdk.forOrg(orgSlug).teams.members.list(teamId);

    if (flags.json === true) {
      emit(JSON.stringify(members, null, 2) + "\n");
      return 0;
    }

    if (members.length === 0) {
      say(
        row(0, [badge("memcell"), label("team member"), place(orgSlug)], [idSeg(teamId)]),
        row(1, [label("no members assigned to this team")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("team member"), place(orgSlug)],
        [variant(`${members.length} member${members.length === 1 ? "" : "s"}`)],
      ),
      ...members.map((m: any) =>
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

export async function addTeamMember(
  instance: string,
  teamId: string,
  userId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  const role = flags.role === "manager" ? "manager" : "member";

  try {
    const sdk = await getSdkClient(instance);
    await sdk.forOrg(orgSlug).teams.members.add(teamId, userId, role);

    say(
      row(0, [badge("memcell"), label("team member add"), place(orgSlug)]),
      row(1, [good("added member")], [idSeg(userId)], [variant(role)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function removeTeamMember(
  instance: string,
  teamId: string,
  userId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const orgSlug = await resolveOrg(flags);
  if (!orgSlug) return missingOrg(instance);

  try {
    const sdk = await getSdkClient(instance);
    await sdk.forOrg(orgSlug).teams.members.remove(teamId, userId);

    say(
      row(0, [badge("memcell"), label("team member remove"), place(orgSlug)]),
      row(1, [good("removed member")], [idSeg(userId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
