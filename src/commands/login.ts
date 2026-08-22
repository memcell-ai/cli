import { deviceGrant } from "../grant.js";
import { whoami } from "../client.js";
import { credentialFor } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, good, label, place, row, say, value, warn, type Row } from "../ui.js";

// This machine, and who is behind it. A terminal cannot hold a browser
// session, so it takes the standard device grant (shared in ../grant): ask
// for a code, show it, let a human approve it in a browser, then exchange
// it for a session this machine can spend.
//
// It signs in and stops there. Wiring a project to a space is `connect`,
// and keeping the two apart is the point — one is about this machine and
// outlives every directory on it, the other is about one directory and can
// happen many times over.

/**
 * What is true about THIS directory, now the machine is signed in.
 *
 * It used to recite "wire a project with memcell connect" whatever the state
 * was. Somebody read that, started their coding agent instead, and had a
 * whole session where the hooks fired and did nothing — with no step in
 * between ever checking whether this directory could run the loop.
 */
async function hereNext(): Promise<Row[]> {
  const found = await findProject(process.cwd());
  return found
    ? [row(2, [good("connected here")], [value(found.project.space)])]
    : [row(2, [warn("not connected here")], [label("run"), cmd("memcell connect")])];
}

export async function login(
  instance: string,
  options: { force?: boolean; noBrowser?: boolean } = {},
): Promise<number> {
  // Already connected is worth saying rather than silently redoing.
  if (!options.force) {
    const existing = await credentialFor(instance);
    if (existing) {
      const session = await whoami(instance).catch(() => null);
      if (session) {
        const who = session.user.isAnonymous ? "as yourself-so-far" : `as ${session.user.name}`;
        say(
          row(0, [badge("memcell"), place(instance)]),
          row(1, [good("connected")], [value(who)]),
          row(2, [label("reconnect as someone else with"), cmd("memcell login --force")]),
        );
        return 0;
      }
    }
  }

  const granted = await deviceGrant(instance, {
    noBrowser: options.noBrowser,
    retry: "memcell login",
  });
  if (!granted) return 1;

  const session = await whoami(instance).catch(() => null);
  const who = session?.user.isAnonymous === false ? session.user.name : "you, so far";
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [good("connected")], [value(who)]),
    ...(await hereNext()),
    session?.user.isAnonymous !== false && row(2, [label("sign in to keep this account")]),
  );
  return 0;
}
