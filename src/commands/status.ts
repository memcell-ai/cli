import { dirname } from "node:path";
import { MemcellError, agentStanding, whoami } from "../client.js";
import { agentKeyForProject } from "../keyring.js";
import { credentialFor, DEFAULT_INSTANCE, knownInstances } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, good, label, place, row, say, time, value, variant, warn } from "../ui.js";

// What this machine knows, checked rather than recited: the stored session
// is presented to the instance, and what comes back is what gets printed —
// in the three levels the CLI speaks in.
//
// It answers BOTH questions, because there are two and they have separate
// answers: who this machine is signed in as, and what this directory is
// linked to. Signed in with nothing linked is the ordinary state right
// after `login`, and a status that showed only the first would leave
// somebody wondering why their agents file nowhere.

export async function status(instance: string, from: string): Promise<number> {
  const credential = await credentialFor(instance);
  const hosted = instance === DEFAULT_INSTANCE;
  const found = await findProject();
  // Where the directory points wins over where the flags do: standing in a
  // linked project and being told about a different memcell is the reading
  // that sends somebody debugging the wrong instance.
  const linked = found
    ? row(1, [good("connected")], [label("to"), value(found.project.space)], [label(found.at)])
    : row(1, [label("not connected here")], [label("connect it with"), cmd("memcell connect")]);

  if (!credential) {
    const others = (await knownInstances()).filter((known) => known !== instance);
    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [variant(from)],
        !hosted && [variant("self-hosted")],
      ),
      row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
      linked,
      others.length > 0 && row(2, [label("elsewhere")], [label(others.join(", "))]),
    );
    return 1;
  }

  try {
    const session = await whoami(instance);
    if (!session) {
      say(
        row(
          0,
          [badge("memcell"), place(instance)],
          [variant(from)],
          !hosted && [variant("self-hosted")],
        ),
        row(1, [warn("session expired")], [label("run"), cmd("memcell login")]),
        linked,
        row(2, [label("obtained")], [time(credential.obtainedAt.slice(0, 16).replace("T", " "))]),
      );
      return 1;
    }

    const who = session.user.isAnonymous ? "you, so far" : session.user.name;
    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [variant(from)],
        !hosted && [variant("self-hosted")],
      ),
      row(1, [good("live")], [value(who)], session.user.isAnonymous && [variant("anonymous")]),
      linked,
      row(2, [label("since"), time(credential.obtainedAt.slice(0, 16).replace("T", " "))]),
      await hookKey(instance, found?.at),
    );
    return 0;
  } catch (error) {
    const failure = error as MemcellError;
    say(
      row(
        0,
        [badge("memcell"), place(instance)],
        [variant(from)],
        !hosted && [variant("self-hosted")],
      ),
      row(1, [warn("unverified")], [label(failure.message)]),
      linked,
    );
    return 1;
  }
}

/** The credential the HOOKS carry, which is not the one above.
 *
 *  `whoami` answers for the person's session; the hooks present an agent key
 *  minted by `memcell connect`. They fail independently, and the way this
 *  goes wrong is silent: a refused hook writes a line to a log nobody reads
 *  and carries on, the agent works without memory, and this command said
 *  "live" the whole time because it was verifying the wrong credential.
 */
async function hookKey(instance: string, projectAt: string | undefined) {
  if (!projectAt) return null;
  const held = await agentKeyForProject(instance, dirname(projectAt));
  if (!held) return row(3, [warn("no agent key")], [label("run"), cmd("memcell connect")]);

  try {
    const said = await agentStanding(instance, held.key);
    if (said.standing === "ok") {
      return row(3, [good("agent key live")], said.agent ? [value(said.agent)] : null, [
        label(`${said.calls.used} of ${said.calls.ceiling} calls today`),
      ]);
    }
    return row(3, [warn(said.standing.replace(/_/g, " "))], [label(said.says ?? "")]);
  } catch (error) {
    // A key the instance will not answer for is the failure this exists to
    // catch — say it, rather than letting the session's "live" stand for it.
    return row(3, [warn("agent key refused")], [label((error as MemcellError).message)]);
  }
}
