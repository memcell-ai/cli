import { dirname } from "node:path";

import { agentStanding } from "../client.js";
import { agentKeyForProject, saveAgentKey } from "../keyring.js";
import { normalize } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, label, place, row, say, warn } from "../ui.js";

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
 *  name. Every refusal names the one command that fixes it.
 *
 *  `url` picks WHICH of this directory's keys to act with. The store holds
 *  one per instance, so a directory connected to a laptop's memcell and to
 *  the hosted one holds two — and without this only the one `.memcell` names
 *  could ever be reached. It selects among what this directory already has;
 *  it never reaches an instance nothing here is wired to, which is what
 *  keeps "where the directory points" the answer rather than a flag. */
export async function wired(what: string, url?: string): Promise<Wired | null> {
  const found = await findProject(process.cwd());
  if (!found) {
    say(
      row(0, [badge("memcell"), label(what)]),
      row(1, [warn("not wired")], [label("run"), cmd("memcell connect")]),
    );
    return null;
  }
  const root = dirname(found.at);
  const instance = url ? normalize(url) : found.project.instance;
  const elsewhere = instance !== normalize(found.project.instance);
  const held = await agentKeyForProject(instance, root);
  if (!held) {
    say(
      row(0, [badge("memcell"), label(what)]),
      elsewhere
        ? row(
            1,
            [warn(`no key here for ${instance}`)],
            [label("wired to"), place(found.project.instance)],
          )
        : row(1, [warn(`no key for ${found.project.space}`)]),
      row(1, [label("run"), cmd(`memcell connect${elsewhere ? ` --url ${instance}` : ""}`)]),
    );
    return null;
  }
  // The key's own space, not the project file's: pointed at another
  // instance, `.memcell` names a slug that lives somewhere else, and it goes
  // straight into the request path.
  let space = held.space ?? (elsewhere ? null : found.project.space);
  if (!space) {
    // A key minted before the store recorded a space. The instance knows —
    // a key answers for exactly one — so ask once and keep the answer,
    // rather than making somebody re-run connect for something already true.
    const standing = await agentStanding(instance, held.key).catch(() => null);
    if (standing?.space) {
      space = standing.space;
      await saveAgentKey({ ...held, space });
    }
  }
  if (!space) {
    say(
      row(0, [badge("memcell"), label(what)]),
      row(1, [warn(`the key for ${instance} does not answer for a space`)]),
      row(1, [label("mint one that does with"), cmd(`memcell connect --url ${instance}`)]),
    );
    return null;
  }
  return { instance, space, key: held.key, agentId: held.agentId, root };
}
