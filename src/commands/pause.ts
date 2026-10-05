import { dirname } from "node:path";

import { findWorkspace, setWorkspacePaused } from "../workspace.js";
import { badge, blank, cmd, good, label, place, row, say, warn } from "../ui.js";

// What pauses the background loop for a project, stored in the project file
// so that every hook short-circuits with zero latency and zero prompt noise.

export async function pause(from?: string): Promise<number> {
  const found = await findWorkspace(from);
  if (!found) {
    say(row(0, [badge("memcell"), warn("not connected")], [label("run"), cmd("memcell connect")]));
    return 1;
  }

  if (found.project.paused) {
    say(
      row(0, [badge("memcell"), label("already paused")]),
      row(1, [
        label("Project".padEnd(11, " ")),
        label(found.project.project || found.project.space),
      ]),
      row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))]),
      row(1, [label("Status".padEnd(11, " ")), warn("paused (hooks inactive)")]),
      blank(),
      row(0, [label("Next:")]),
      row(1, [cmd("memcell resume".padEnd(21, " ")), label("Resume hooks for this project")]),
    );
    return 0;
  }

  await setWorkspacePaused(true, found.at);

  say(
    row(0, [badge("memcell"), good("paused")]),
    row(1, [label("Project".padEnd(11, " ")), label(found.project.project || found.project.space)]),
    row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))]),
    row(1, [label("Status".padEnd(11, " ")), warn("paused (hooks inactive)")]),
    blank(),
    row(0, [label("Next:")]),
    row(1, [cmd("memcell resume".padEnd(21, " ")), label("Resume hooks for this project")]),
  );
  return 0;
}

export async function resume(from?: string): Promise<number> {
  const found = await findWorkspace(from);
  if (!found) {
    say(row(0, [badge("memcell"), warn("not connected")], [label("run"), cmd("memcell connect")]));
    return 1;
  }

  if (!found.project.paused) {
    say(
      row(0, [badge("memcell"), label("already active")]),
      row(1, [
        label("Project".padEnd(11, " ")),
        label(found.project.project || found.project.space),
      ]),
      row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))]),
      row(1, [label("Status".padEnd(11, " ")), good("active (hooks enabled)")]),
    );
    return 0;
  }

  await setWorkspacePaused(false, found.at);

  say(
    row(0, [badge("memcell"), good("resumed")]),
    row(1, [label("Project".padEnd(11, " ")), label(found.project.project || found.project.space)]),
    row(1, [label("Directory".padEnd(11, " ")), place(dirname(found.at))]),
    row(1, [label("Status".padEnd(11, " ")), good("active (hooks enabled)")]),
  );
  return 0;
}
