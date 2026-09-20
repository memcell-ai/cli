import { agentStanding, call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { dirname } from "node:path";

import { agentKeyForProject } from "../keyring.js";
import { findProject } from "../project.js";
import { badge, cmd, good, id, label, place, row, say, time, value, variant, warn } from "../ui.js";

// The agents wired to this account, and the way to take one back.
//
// This was `keys`, and the rename is the model rather than taste. A key is
// not a thing anybody thinks about: "revoke the cursor key on this laptop"
// is how somebody reaches for it, and the id is an implementation detail
// they should have to see only when two agents share a name. So the resource
// is the agent, and the key is what it holds.
//
// The key itself is never shown. memcell keeps a hash and a fingerprint, so
// there is nothing here to print even if it would be convenient for whoever
// lost it — a lost key is re-minted, never recovered.

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

export async function listAgents(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const { keys: rows } = await call<{ keys: KeyRow[] }>(instance, "/api/v1/keys");
    if (rows.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [label("no agents")], [label("connect one with"), cmd("memcell connect")]),
      );
      return 0;
    }

    // The agent this directory wired is worth pointing at: in a list of
    // eight, "which of these is the one I am standing in" is the question
    // being asked, and the id alone does not answer it. Identity is the
    // keyring's, found by the wired directory.
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
          [id(k.id)],
          k.id === here?.keyId && [variant("here")],
        ),
      ),
      row(2, [label("revoke one with"), cmd("memcell agents revoke <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

export async function revokeAgent(instance: string, keyId: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    await call(instance, `/api/v1/keys?id=${encodeURIComponent(keyId)}`, { method: "DELETE" });
    say(
      row(0, [badge("memcell"), place(instance)]),
      // Said plainly, because the two halves surprise people separately:
      // the agent stops on its next call, and nothing it filed is touched.
      row(1, [good("revoked")], [id(keyId)]),
      row(2, [label("stops at its next call · what it filed stays")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
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
      row(2, [label("key:"), id(held.keyId)]),
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
