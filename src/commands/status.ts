import { MemcellError, whoami } from "../client.js";
import { credentialFor, DEFAULT_INSTANCE, knownInstances, whereInstance } from "../instance.js";
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

export async function status(instance: string): Promise<number> {
  const credential = await credentialFor(instance);
  const hosted = instance === DEFAULT_INSTANCE;
  const found = await findProject();
  // Where this points is a setting now, so status says what decided it —
  // "why am I talking to that one" should never need a support question.
  const { from } = await whereInstance();

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
