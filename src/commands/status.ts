import { dirname } from "node:path";
import { MemcellError, agentStanding, whoami } from "../client.js";
import { agentKeyForProject, listConnectedProjects } from "../keyring.js";
import { credentialFor, DEFAULT_INSTANCE, knownInstances } from "../instance.js";
import { findProject } from "../project.js";
import { badge, blank, cmd, good, label, place, row, say, value, warn } from "../ui.js";

// What this machine knows, checked rather than recited: the stored session
// is presented to the instance, and what comes back is what gets printed in
// a clean, aligned, scannable format.

export async function status(instance: string, _from: string): Promise<number> {
  const credential = await credentialFor(instance);
  const hosted = instance === DEFAULT_INSTANCE;
  const found = await findProject();

  const projectDisplay = found
    ? found.project.owner
      ? `${found.project.owner}/${found.project.project || found.project.space}`
      : found.project.project || found.project.space
    : null;

  const instanceScope = !hosted ? label("(self-hosted)") : label("(cloud)");

  if (!credential) {
    const others = (await knownInstances()).filter((known) => known !== instance);
    say(
      row(0, [badge("memcell"), place(instance)], [instanceScope]),
      row(1, [label("Status".padEnd(11, " ")), warn("not signed in")]),
      found ? row(1, [label("Project".padEnd(11, " ")), value(projectDisplay!)]) : null,
      found
        ? row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))])
        : row(1, [label("Directory".padEnd(11, " ")), place(process.cwd())]),
      others.length > 0
        ? row(1, [label("Instances".padEnd(11, " ")), label(others.join(", "))])
        : null,
      blank(),
      row(0, [label("Next:")]),
      row(1, [cmd("memcell login".padEnd(21, " ")), label("Sign in to this instance")]),
    );
    return 1;
  }

  try {
    const session = await whoami(instance);
    if (!session) {
      say(
        row(0, [badge("memcell"), place(instance)], [instanceScope]),
        row(1, [label("Status".padEnd(11, " ")), warn("session expired")]),
        found ? row(1, [label("Project".padEnd(11, " ")), value(projectDisplay!)]) : null,
        found
          ? row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))])
          : row(1, [label("Directory".padEnd(11, " ")), place(process.cwd())]),
        blank(),
        row(0, [label("Next:")]),
        row(1, [cmd("memcell login".padEnd(21, " ")), label("Sign in to this instance")]),
      );
      return 1;
    }

    const who = session.user.isAnonymous ? "Anonymous" : session.user.name;
    const accountDisplay = session.user.isAnonymous ? "Anonymous" : `${who} (Personal)`;

    if (found) {
      const keyRow = await hookKey(
        instance,
        found.at,
        found.project.projectId ?? (found.project.project || found.project.space),
      );

      say(
        row(0, [badge("memcell"), place(instance)], [instanceScope]),
        row(1, [label("Account".padEnd(11, " ")), value(accountDisplay)]),
        row(1, [label("Project".padEnd(11, " ")), value(projectDisplay!)]),
        row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))]),
        keyRow,
      );
      return 0;
    }

    // Not connected in current directory
    const connected = await listConnectedProjects(instance);
    say(
      row(0, [badge("memcell"), place(instance)], [instanceScope]),
      row(1, [label("Account".padEnd(11, " ")), value(accountDisplay)]),
      row(1, [label("Project".padEnd(11, " ")), warn("not connected in this directory")]),
      row(1, [label("Directory".padEnd(11, " ")), place(process.cwd())]),
      ...connected.map((c) =>
        row(
          1,
          [
            label("Connected".padEnd(11, " ")),
            good(c.ownerSlug ? `${c.ownerSlug}/${c.projectSlug}` : c.projectSlug || "unknown"),
          ],
          c.projectPath ? [place(c.projectPath)] : null,
        ),
      ),
      blank(),
      row(0, [label("Next:")]),
      row(1, [
        cmd("memcell connect".padEnd(21, " ")),
        label("Connect this directory to a project"),
      ]),
    );
    return 0;
  } catch (error) {
    const failure = error as MemcellError;
    say(
      row(0, [badge("memcell"), place(instance)], [instanceScope]),
      row(1, [label("Status".padEnd(11, " ")), warn("unverified")], [label(failure.message)]),
      found ? row(1, [label("Project".padEnd(11, " ")), value(projectDisplay!)]) : null,
      found
        ? row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))])
        : row(1, [label("Directory".padEnd(11, " ")), place(process.cwd())]),
    );
    return 1;
  }
}

/** The credential the HOOKS carry, which is verified independently. */
async function hookKey(instance: string, projectAt: string | undefined, projectIdOrSlug?: string) {
  if (!projectAt) return null;
  const held = await agentKeyForProject(instance, dirname(projectAt), undefined, projectIdOrSlug);
  if (!held) {
    return row(
      1,
      [label("Agent Key".padEnd(11, " ")), warn("no agent key")],
      [label("run"), cmd("memcell connect")],
    );
  }

  try {
    const said = await agentStanding(instance, held.key);
    if (said.standing === "ok") {
      const agentName = said.agent || held.agent || "default";
      return row(1, [label("Agent Key".padEnd(11, " ")), value(agentName)], [good("active")]);
    }
    return row(
      1,
      [label("Agent Key".padEnd(11, " ")), warn(said.standing.replace(/_/g, " "))],
      [label(said.says ?? "")],
    );
  } catch (error) {
    return row(
      1,
      [label("Agent Key".padEnd(11, " ")), warn("refused")],
      [label((error as MemcellError).message)],
    );
  }
}
