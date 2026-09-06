import { migrateWiring } from "./adapters/index.js";
import { COMMANDS } from "./commands/index.js";
import { detail, overview, refusal } from "./help.js";
import { badInstance, whereInstance } from "./instance.js";
import { parse } from "./parse.js";
import { findProject } from "./project.js";
import { dirname } from "node:path";

// The entry point, and now only that: parse, resolve which memcell, run.
//
// It used to hold the parser, the help text and the dispatch switch, which
// is why all three could disagree. What decides anything now is the command
// declarations in `commands/index.ts` — this file has no opinion about what
// exists.

export async function main(argv: string[], version: string): Promise<number> {
  const parsed = parse(argv, COMMANDS);

  switch (parsed.kind) {
    case "version":
      console.log(version);
      return 0;

    case "help":
      console.log(parsed.topic ? detail(parsed.topic) : overview());
      return 0;

    case "error":
      // Refusals go to stderr so a script can separate them from output,
      // and they carry the help for what was actually being reached for
      // rather than the whole surface.
      console.error(refusal(parsed.message, parsed.hint));
      return 1;

    case "run": {
      const flag = parsed.flags.url;
      const { instance, from } = await whereInstance(typeof flag === "string" ? flag : undefined);

      // Refused here rather than carried down. A typo in `--url` used to
      // reach the sign-in check and come back as "not signed in", sending
      // somebody to log in to something that cannot exist. The hook is the
      // exception: it runs inside a session and never fails closed, whatever
      // its config says.
      const wrong = badInstance(instance);
      if (wrong && parsed.command.path[0] !== "hook") {
        console.error(refusal(wrong));
        return 1;
      }

      // Carry an older release's wiring forward before doing the work.
      // Every entry runs it, the hook firings included, which is what makes
      // an upgrade need nothing from anybody: the first hook after it
      // migrates itself and every later one finds nothing to do. It never
      // fails the command it precedes — a wiring we could not rewrite is
      // still a wiring that fires.
      const found = await findProject().catch(() => null);
      if (found) await migrateWiring(dirname(found.at)).catch(() => []);

      return parsed.command.run({
        instance,
        from,
        args: parsed.args,
        flags: parsed.flags,
        many: parsed.many,
      });
    }
  }
}
