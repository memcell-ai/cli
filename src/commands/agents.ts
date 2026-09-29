import { dirname } from "node:path";
import { MemCellError } from "@memcell/sdk";
import { agentStanding, call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { agentKeyForProject } from "../keyring.js";
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
  time,
  value,
  variant,
  warn,
} from "../ui.js";

interface KeyRow {
  id: string;
  agent: string;
  machine: string;
  space: string;
  active: boolean;
  created: string;
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

export async function listAgents(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    // If a project is explicitly requested, list registered agents in that project
    if (typeof flags.project === "string") {
      const namespace = await resolveNamespace(sdk, flags.project);
      const res = await sdk.agents.list(namespace);
      const items = res.items || [];

      if (items.length === 0) {
        say(
          row(0, [badge("memcell"), label("agents"), place(namespace)]),
          row(1, [label("no agents registered in this project")]),
          row(2, [label("register one with"), cmd("memcell agents new <name>")]),
        );
        return 0;
      }

      say(
        row(
          0,
          [badge("memcell"), label("agents"), place(namespace)],
          [variant(`${items.length} agent${items.length === 1 ? "" : "s"}`)],
        ),
        ...items.map((a) =>
          row(
            1,
            [a.status === "active" ? good(a.name) : warn(a.name)],
            a.kind ? [variant(a.kind)] : null,
            a.description ? [label(a.description)] : null,
            [idSeg(a.id)],
          ),
        ),
      );
      return 0;
    }

    // Default: list machine/account agent keys (as before)
    const { keys: rows } = await call<{ keys: KeyRow[] }>(instance, "/api/v1/keys");
    if (rows.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [label("no agents")]),
        row(2, [label("connect one with"), cmd("memcell connect")]),
      );
      return 0;
    }

    const found = await findProject();
    const here = found ? await agentKeyForProject(found.project.instance, dirname(found.at)) : null;

    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [variant(`${rows.length} agent${rows.length === 1 ? "" : "s"}`)],
      ),
      ...rows.map((k) =>
        row(
          1,
          [k.active ? good(k.agent) : warn(k.agent)],
          [label("on"), value(k.machine)],
          [label("in"), value(k.space)],
          [idSeg(k.id)],
          k.id === here?.keyId && [variant("here")],
        ),
      ),
      row(2, [label("revoke one with"), cmd("memcell agents revoke <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.project as string);
    const agent = await sdk.agents.get(namespace, agentId);

    say(
      row(0, [badge("memcell"), label("agent"), place(namespace)], [idSeg(agent.id)]),
      row(
        1,
        [agent.status === "active" ? good(agent.name) : warn(agent.name)],
        agent.kind ? [variant(agent.kind)] : null,
        agent.status ? [variant(agent.status)] : null,
      ),
      agent.description ? row(2, [label(agent.description)]) : null,
      agent.createdAt ? row(2, [label("registered:"), time(String(agent.createdAt))]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createAgent(
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
    const namespace = await resolveNamespace(sdk, flags.project as string);
    const description = typeof flags.description === "string" ? flags.description : undefined;
    const type =
      typeof flags.type === "string"
        ? flags.type
        : typeof flags.kind === "string"
          ? flags.kind
          : undefined;

    const created = await sdk.agents.create(namespace, {
      name,
      description,
      kind: type as any,
    });

    say(
      row(0, [badge("memcell"), label("agents create"), place(namespace)]),
      row(1, [good("registered")], [value(created.name)], [idSeg(created.id)]),
      row(2, [label("mint a key with"), cmd(`memcell agents key create ${created.id}`)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.project as string);
    const name = typeof flags.name === "string" ? flags.name : undefined;
    const description = typeof flags.description === "string" ? flags.description : undefined;
    const status = typeof flags.status === "string" ? (flags.status as any) : undefined;

    const updated = await sdk.agents.update(namespace, agentId, {
      name,
      description,
      status,
    });

    say(
      row(0, [badge("memcell"), label("agents update"), place(namespace)]),
      row(1, [good("updated")], [value(updated.name)], [idSeg(updated.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteAgent(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.project as string);
    await sdk.agents.delete(namespace, agentId);

    say(
      row(0, [badge("memcell"), label("agents delete"), place(namespace)]),
      row(1, [good("deleted")], [idSeg(agentId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createAgentKey(
  instance: string,
  agentId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const namespace = await resolveNamespace(sdk, flags.project as string);
    const key = await sdk.agents.createKey(namespace, agentId);

    say(
      row(0, [badge("memcell"), label("agents key create"), place(namespace)]),
      row(1, [good("minted key")], [idSeg(key.id)]),
      key.key ? row(2, [label("token:"), value(key.key)]) : null,
      row(2, [label("keep this key secure — it is shown only once")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function revokeAgentKey(
  instance: string,
  keyIdOrAgentId: string,
  secondArg?: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    if (secondArg) {
      // Called with agentId + keyId: sdk.agents.revokeKey(namespace, agentId, keyId)
      const sdk = await getSdkClient(instance);
      const namespace = await resolveNamespace(sdk, flags.project as string);
      await sdk.agents.revokeKey(namespace, keyIdOrAgentId, secondArg);
      say(
        row(0, [badge("memcell"), label("agents key revoke"), place(namespace)]),
        row(1, [good("revoked")], [idSeg(secondArg)]),
      );
      return 0;
    }

    // Single arg: revoke via global keys API (backward-compatible)
    await call(instance, `/api/v1/keys?id=${encodeURIComponent(keyIdOrAgentId)}`, {
      method: "DELETE",
    });
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("revoked")], [idSeg(keyIdOrAgentId)]),
      row(2, [label("stops at its next call · what it filed stays")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function revokeAgent(instance: string, keyId: string): Promise<number> {
  return revokeAgentKey(instance, keyId);
}

export async function whoamiAgent(instance: string): Promise<number> {
  const found = await findProject();
  if (!found) {
    say(
      row(0, [badge("memcell"), label("agents whoami")]),
      row(1, [warn("not wired")], [label("run"), cmd("memcell connect")]),
    );
    return 1;
  }

  const root = dirname(found.at);
  const held = await agentKeyForProject(found.project.instance, root);
  if (!held) {
    say(
      row(0, [badge("memcell"), label("agents whoami")]),
      row(1, [warn("no agent key found here")]),
      row(2, [label("run"), cmd("memcell connect")]),
    );
    return 1;
  }

  try {
    const standing = await agentStanding(instance, held.key);
    const proj = standing.space || found.project.project || found.project.space;
    say(
      row(0, [badge("memcell"), label("agent standing"), place(instance)]),
      row(
        1,
        [
          standing.standing === "ok"
            ? good(standing.agent || held.agent || "agent")
            : warn(standing.agent || held.agent || "agent"),
        ],
        [label("standing:"), value(standing.standing)],
        proj ? [label("on"), value(proj)] : null,
      ),
      typeof standing.calls?.used === "number"
        ? row(2, [label("calls:"), value(standing.calls.used.toLocaleString())])
        : null,
      row(2, [label("key:"), idSeg(held.keyId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
