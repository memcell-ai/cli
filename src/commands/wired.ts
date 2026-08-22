import { dirname } from "node:path";

import { agentKeyForProject } from "../keyring.js";
import { findProject } from "../project.js";
import { badge, cmd, label, row, say, warn } from "../ui.js";

// What every command that acts on a space needs: the directory's wiring and
// the key minted for it. The connection IS the credential — a wired
// directory names its instance and space, and the key answers for both, so
// none of these commands asks for a login.

export interface Wired {
  instance: string;
  space: string;
  key: string;
  agentId?: string;
  /** The directory holding `.memcell` — the wiring's root, not the cwd. */
  root: string;
}

/** The wiring, or null with the refusal already printed in the command's own
 *  name. Both refusals name the one command that fixes them. */
export async function wired(what: string): Promise<Wired | null> {
  const found = await findProject(process.cwd());
  if (!found) {
    say(
      row(0, [badge("memcell"), label(what)]),
      row(1, [warn("not wired")], [label("run"), cmd("memcell connect")]),
    );
    return null;
  }
  const root = dirname(found.at);
  const held = await agentKeyForProject(found.project.instance, root);
  if (!held) {
    say(
      row(0, [badge("memcell"), label(what)]),
      row(1, [warn(`no key for ${found.project.space}`)], [label("run"), cmd("memcell connect")]),
    );
    return null;
  }
  return {
    instance: found.project.instance,
    space: found.project.space,
    key: held.key,
    agentId: held.agentId,
    root,
  };
}
