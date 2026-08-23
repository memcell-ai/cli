import { hostname } from "node:os";
import { basename, dirname } from "node:path";

import { memcellOnPath } from "../adapters/shared.js";
import { UnreadableConfig } from "../adapters/shared.js";
import { installSkill } from "../adapters/skill.js";
import { adapterFor } from "../adapters/index.js";
import { detected } from "../agents.js";
import { call, MemcellError, whoami } from "../client.js";
import { deviceGrant } from "../grant.js";
import { credentialFor } from "../instance.js";
import { saveAgentKey } from "../keyring.js";
import { saveProject } from "../project.js";
import { badge, cmd, good, label, place, row, say, value, viaNpx, warn } from "../ui.js";

// `memcell connect` — a cold terminal to a wired project, one command.
//
// Bare, it is terminal-first: if this machine holds no session, the device
// grant runs right here (code, browser, approve — anonymous counts), and
// then the key is minted against the approver's active space. With
// `--pair <id>` it is the terminal's half of the browser flow instead: the
// connect page made a pairing as whoever was in the browser, and holding
// the ticket is standing enough. Both paths end in the same wiring.

interface Exchanged {
  key: string;
  keyId: string;
  agentId: string;
  space: { id: string; slug: string; name: string };
  instance: string;
}

export async function connect(
  instance: string,
  options: { pair?: string; space?: string; noBrowser?: boolean; instanceFlag?: string },
): Promise<number> {
  const pair = options.pair?.trim();
  const space = options.space?.trim();

  // WHERE this is about to authenticate, said out loud when the directory
  // chose it. `.memcell` is committed and outranks this machine's own
  // config, so a cloned repository decides which host receives the device
  // grant and mints the key. That is fine when it is expected and worth
  // seeing when it is not — the host is named before anything is sent.
  const { whereInstance } = await import("../instance.js");
  const chose = await whereInstance(options.instanceFlag);
  if (chose.from === "project") {
    say(
      row(0, [badge("memcell"), label("connecting to")], [place(chose.instance)]),
      row(1, [label("chosen by this directory's .memcell")]),
    );
  }

  const here = basename(process.cwd());
  const present = [...(await detected())];
  const identity = { agent: present[0] ?? here, machine: hostname() };

  let exchanged: Exchanged;
  try {
    if (pair) {
      exchanged = await call<Exchanged>(instance, "/api/v1/pair/claim", {
        method: "POST",
        // `space` names which of the caller's spaces to reach, by slug;
        // without it the pairing's own space (the active or a fresh one).
        body: { pair, ...identity, space: space || undefined },
      });
    } else {
      // Terminal-first: a session, then the key. A held credential that
      // still answers is a session; otherwise the device grant runs here.
      const held = (await credentialFor(instance))
        ? await whoami(instance).catch(() => null)
        : null;
      if (!held) {
        const granted = await deviceGrant(instance, {
          noBrowser: options.noBrowser,
          retry: "memcell connect",
        });
        if (!granted) return 1;
      }
      exchanged = await call<Exchanged>(instance, "/api/v1/connect", {
        method: "POST",
        body: { ...identity, space: space || undefined },
      });
    }
  } catch (error) {
    const failure = error as MemcellError;
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("could not connect")], [label(failure.message)]),
    );
    return 1;
  }

  // The project file carries project truth only — safe to commit, identical
  // for every teammate. Identity (the agent, the key) is personal and goes to
  // the machine keyring, so a re-connect never rewrites a committed file.
  // Pinned to the host that was ASKED, not the one named in the answer. A
  // response that renames its own instance would otherwise redirect every
  // later call — and the credential with it — to somewhere the person never
  // typed.
  if (exchanged.instance && new URL(exchanged.instance).origin !== new URL(instance).origin) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [warn("refused")], [label(`that instance answered for ${exchanged.instance}`)]),
    );
    return 1;
  }
  const at = await saveProject({
    instance,
    space: exchanged.space.slug,
    spaceId: exchanged.space.id,
  });
  await saveAgentKey({
    instance,
    keyId: exchanged.keyId,
    key: exchanged.key,
    project: process.cwd(),
    agentId: exchanged.agentId,
  });

  // The hooks: the loop fires because the harness runs them. Installed for
  // whatever agents this machine actually uses.
  const wired: string[] = [];
  const refused: string[] = [];
  for (const name of present) {
    const adapter = adapterFor(name);
    if (!adapter) continue;
    try {
      await adapter.install(process.cwd());
      wired.push(name);
    } catch (trouble) {
      // One agent's config being unreadable is not a reason to abandon the
      // others, and it is never a reason to rewrite it. Named here so the
      // person knows which file to look at.
      if (trouble instanceof UnreadableConfig) {
        refused.push(name);
        continue;
      }
      throw trouble;
    }
  }
  // The wiring names `memcell` and nothing else, so it travels. That only
  // works if a hook's shell can find it — and a hook that cannot is a hook
  // that silently does nothing, which is the failure this whole loop is
  // least able to notice. Asked once, here, where somebody is reading.
  const onPath = await memcellOnPath();

  // The shared skill — one file at the cross-agent reach point, teaching
  // the loop's four doors. Reinforcement for every agent here and any that
  // arrives later; the hooks above stay the enforcement.
  installSkill(process.cwd());

  say(
    row(0, [badge("memcell"), value(exchanged.space.name)]),
    row(1, [good("connected")], [place(dirname(at))]),
    wired.length > 0
      ? row(
          1,
          [good("hooks")],
          [value(wired.join(", "))],
          [label("recall runs before your agent answers")],
        )
      : row(1, [warn("no agents detected here")], [label("run this in a project you code in")]),
    refused.length > 0 &&
      row(
        1,
        [warn(`not wired: ${refused.join(", ")}`)],
        [label("its config is not valid JSON — fix it, then run this again")],
      ),
    row(
      1,
      [good("skill")],
      [place(".agents/skills/memcell")],
      [label("teaches any agent the four doors")],
    ),
    !onPath &&
      row(
        1,
        [warn("memcell is not on your agent's PATH")],
        [label("the hooks will not fire until it is")],
        [value("npm install -g memcell")],
      ),
    row(2, [label("check it")], [cmd("memcell status")]),
    row(2, [label("undo it")], [cmd("memcell hook remove")]),
    // The space above was the instance's pick, not the caller's — say how
    // to choose, right where the pick just became visible.
    !space && row(2, [label("a different space")], [cmd(`memcell connect --space <slug>`)]),
    // An npx run leaves no binary behind: `memcell` alone stays "command
    // not found" until the package is actually installed. Say so here,
    // where the habit of typing the short name begins.
    viaNpx() &&
      row(
        2,
        [label("keep it")],
        [value("npm install -g memcell")],
        [label("then it is just memcell")],
      ),
  );
  return 0;
}
