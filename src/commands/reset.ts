import { readdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { removeAllHooks } from "../adapters/index.js";
import { agentKeys } from "../keyring.js";
import { MACHINE_STATE, machineDir, machineFile } from "../machine.js";
import { findProject, removeProject } from "../project.js";
import { confirm } from "../select.js";
import {
  badge,
  cmd,
  good,
  label,
  list,
  place,
  row,
  say,
  value,
  variant,
  warn,
  type Row,
} from "../ui.js";

// Forget what memcell keeps here — on this machine, and in this directory.
//
// The machine half: the session, the keys, the settings, the hook log. The
// directory half: the connection this folder holds and the hooks in it, when
// reset is run somewhere connected. So reset in a project cleans that project
// too, rather than leaving its hooks firing against a key that is gone.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO, and says so:
//
//   The keys stay live. A key is a credential on the instance, not here;
//   forgetting a copy of it locally leaves it working for anybody who has
//   another copy. Revoking is a different act — `memcell agents`.
//
//   Hooks in OTHER directories stay. It only unwires the one it is run in,
//   because it only knows that one. The rest fire, find no key, and do
//   nothing — quietly, because a hook that talks is worse than one that is
//   quiet.
//
// It asks before it acts. `--force` skips the question, for a script.

async function held(): Promise<{ path: string; what: string; then?: string }[]> {
  const there: { path: string; what: string; then?: string }[] = [];
  for (const entry of MACHINE_STATE) {
    const found = await stat(machineFile(entry.path)).then(
      () => true,
      () => false,
    );
    if (found) there.push({ ...entry });
  }
  return there;
}

/** Anything in the machine directory the list does not name. Said rather than
 *  removed: this command is trusted precisely because it does not delete what
 *  it cannot describe. */
async function unaccounted(): Promise<string[]> {
  const named = new Set<string>(MACHINE_STATE.map((e) => e.path));
  const entries = await readdir(machineDir()).catch(() => [] as string[]);
  return entries.filter((e) => !named.has(e));
}

/**
 * Forget what memcell keeps — on this machine, and in one directory.
 *
 * `at` is that directory, and it is a PARAMETER rather than process.cwd()
 * read inside: a destructive command that discovers its own target from
 * ambient state cannot be tested safely, because the project search climbs
 * parents and can resolve to a wired directory outside the caller's
 * sandbox.
 */
export async function reset(force: boolean, at: string = process.cwd()): Promise<number> {
  const there = await held();
  const strays = await unaccounted();
  const here = await findProject(at);

  if (there.length === 0 && strays.length === 0 && !here) {
    say(
      row(0, [badge("memcell")]),
      row(
        1,
        [label("nothing to reset")],
        [label("this machine is clean, and this folder is not connected")],
      ),
    );
    return 0;
  }

  // Read before anything goes: what is still live elsewhere afterwards.
  const keys = await agentKeys();
  const otherProjects = [...new Set(keys.map((k) => k.project))].filter(
    (p) => !here || p !== dirname(here.at),
  );

  // What is about to go, named before the question is asked.
  const plan: (Row | false | null)[] = [
    row(0, [badge("memcell")]),
    there.length > 0 && row(1, [label("on this machine")], [place(machineDir())]),
    ...there.map((entry) => row(2, [value(entry.path)], [label(entry.what)])),
    strays.length > 0 && row(1, [warn("left alone")], [list(strays)]),
    here &&
      row(
        1,
        [value("this directory")],
        [label("its connection and hooks"), place(dirname(here.at))],
      ),
  ];

  if (!force) {
    const yes = await confirm("Forget all of it?");
    if (yes === null) {
      // Nobody to ask — a pipe, a script, CI. Show the plan and require the
      // flag, rather than hang waiting on an answer that will not come.
      plan.push(row(1, [label("to do this non-interactively")], [cmd("memcell reset --force")]));
      say(...plan);
      return 1;
    }
    if (!yes) {
      say(...plan, row(1, [label("left as it is")], [label("nothing was removed")]));
      return 0;
    }
  }

  for (const entry of there) {
    await rm(machineFile(entry.path), { recursive: true, force: true });
  }

  // This directory: take out its hooks, then forget the connection. The
  // project may sit ABOVE where the command was run — the search climbs —
  // so the report names the directory rather than leaving somebody to
  // assume it meant the one they were standing in.
  if (here) {
    await removeAllHooks(dirname(here.at));
    await removeProject(here.at);
  }

  const out: (Row | false | null)[] = [
    row(0, [badge("memcell")]),
    there.length > 0 && row(1, [good("forgotten")], [label("this machine holds none of it")]),
    here && row(1, [good("disconnected")], [place(dirname(here.at))]),
    strays.length > 0 && row(1, [warn("left alone")], [list(strays)]),
    ...there.filter((entry) => entry.then).map((entry) => row(2, [label(entry.then!)])),
  ];

  // The half this cannot undo.
  if (keys.length > 0) {
    out.push(
      row(
        1,
        [warn("keys still live")],
        [variant(`${keys.length}`)],
        [label("forgotten here only")],
      ),
      row(2, [label("revoke with")], [cmd("memcell agents")]),
    );
  }
  if (otherProjects.length > 0) {
    out.push(
      row(1, [warn("hooks still installed elsewhere")], [variant(`${otherProjects.length}`)]),
      row(2, [label("run memcell reset in each to unwire it")]),
      ...otherProjects.map((p) => row(2, [place(p)])),
    );
  }

  say(...out);
  return 0;
}
