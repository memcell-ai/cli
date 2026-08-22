import { canonical, fileFor, get, read, set, show, type WritableScope } from "../config.js";
import { badge, cmd, good, label, place, row, say, value, variant, warn } from "../ui.js";

// `memcell config get|set [--global] <key> [value]`.
//
// Two scopes, one precedence: the project wins. `get` says which file
// answered — a setting that behaves differently in two directories is
// otherwise indistinguishable from a bug.

export async function configGet(key: string, global: boolean): Promise<number> {
  const found = await get(key, global ? { only: "global" } : {});
  if (!found) {
    say(
      row(0, [badge("memcell")], [label(key)]),
      row(1, [label("not set")], global ? [variant("globally")] : null),
    );
    return 1;
  }

  // A flag or an environment variable has no file to name; the two that do
  // get named, because "which file said so" is the question a settings
  // command exists to answer.
  const file =
    found.scope === "project" || found.scope === "global" ? await fileFor(found.scope) : null;
  say(
    row(0, [badge("memcell")], [label(canonical(key))]),
    row(1, [value(show(found.value))], [variant(found.scope)]),
    file ? row(2, [place(file)]) : null,
  );
  return 0;
}

export async function configSet(key: string, raw: string, global: boolean): Promise<number> {
  const scope: WritableScope = global ? "global" : "project";
  try {
    const file = await set(key, read(raw), scope);
    // Say when something else still wins: a set that appears to do nothing
    // is the worst thing a settings command can do quietly.
    const winner = await get(key);
    say(
      row(0, [badge("memcell")], [label(canonical(key))]),
      row(1, [good("set")], [value(show(read(raw)))], [variant(scope)]),
      row(2, [place(file)]),
      // A set that appears to do nothing is the worst thing a settings
      // command can do quietly — so it says what is actually winning.
      winner && winner.scope !== scope
        ? row(1, [warn(`${winner.scope} still wins here`)], [value(show(winner.value))])
        : null,
    );
    return 0;
  } catch (error) {
    say(
      row(0, [badge("memcell")], [label(canonical(key))]),
      row(1, [warn("not set")], [label((error as Error).message)]),
      row(2, [
        label("or set it for this machine with"),
        cmd(`memcell config set --global ${key} ${raw}`),
      ]),
    );
    return 1;
  }
}
