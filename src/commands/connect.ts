import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { memcellOnPath } from "../adapters/shared.js";
import { UnreadableConfig } from "../adapters/shared.js";
import { installSkill } from "../adapters/skill.js";
import { adapterFor } from "../adapters/index.js";
import { currentAgent, detected } from "../agents.js";
import { call, MemcellError, whoami } from "../client.js";
import { deviceGrant } from "../grant.js";
import {
  badInstance,
  credentialFor,
  DEFAULT_INSTANCE,
  knownInstances,
  normalize,
} from "../instance.js";
import { pruneProjectKeys, saveAgentKey } from "../keyring.js";
import { resolveModelForAgent } from "../model-detect.js";
import { findGitRoot, findProject, PROJECT_FILE, saveProject } from "../project.js";
import { ask, CAN_ASK, choose, type Choice } from "../select.js";
import {
  badge,
  blank,
  cmd,
  good,
  label,
  place,
  row,
  say,
  value,
  variant,
  viaNpx,
  warn,
} from "../ui.js";

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
  project?: { id: string; slug: string; name: string; ownerSlug?: string };
  space: { id: string; slug: string; name: string; ownerSlug?: string };
  instance: string;
  agents?: Record<string, { key: string; keyId: string; agentId: string; agentName: string }>;
}

export async function connect(
  instance: string,
  options: {
    pair?: string;
    project?: string;
    space?: string;
    agent?: string;
    noBrowser?: boolean;
    from: string;
  },
): Promise<number> {
  const pair = options.pair?.trim();
  const existing = await findProject(process.cwd()).catch(() => null);
  let targetProject = (options.project || options.space)?.trim();

  const isInteractive = !pair && !options.project && !options.space && CAN_ASK();

  if (isInteractive) {
    let action: string | null = null;
    if (existing) {
      const currentSlug = existing.project.owner
        ? `${existing.project.owner}/${existing.project.project || existing.project.space}`
        : existing.project.project || existing.project.space;

      say(
        row(0, [badge("memcell"), label("workspace connection detected")]),
        row(
          1,
          [label("connected to")],
          [good(currentSlug)],
          [label("on"), place(existing.project.instance)],
        ),
        row(2, [label("file:")], [label(existing.at)]),
      );

      action = await choose("What would you like to do?", [
        {
          name: "keep",
          label: "Keep current connection & refresh keys",
          note: currentSlug,
        },
        {
          name: "switch_project",
          label: "Switch project or organization",
        },
        {
          name: "switch_instance",
          label: "Switch target instance (Cloud / Local / Custom)",
          note: existing.project.instance,
        },
        {
          name: "cancel",
          label: "Cancel",
        },
      ]);

      if (!action || action === "cancel") return 0;

      if (action === "keep") {
        targetProject = currentSlug;
        instance = existing.project.instance;
      } else if (action === "switch_project") {
        instance = existing.project.instance;
      }
    }

    // Instance selection (if fresh or user requested instance switch)
    if (action === "switch_instance" || (!existing && options.from === "default")) {
      const known = await knownInstances();
      const instanceChoices: Choice[] = [
        {
          name: DEFAULT_INSTANCE,
          label: "MemCell Cloud",
          note: "https://memcell.ai (Production)",
        },
        {
          name: "http://localhost:3000",
          label: "Local Development",
          note: "http://localhost:3000",
        },
        ...known
          .filter((k) => k !== DEFAULT_INSTANCE && k !== "http://localhost:3000")
          .map((k) => ({ name: k, label: "Saved Instance", note: k })),
        {
          name: "custom",
          label: "Custom / Self-Hosted URL...",
        },
      ];

      const pickedInstance = await choose("Select MemCell instance:", instanceChoices);
      if (!pickedInstance) return 0;

      if (pickedInstance === "custom") {
        const customUrl = await ask("Enter MemCell instance URL");
        if (!customUrl) return 0;
        const wrong = badInstance(customUrl);
        if (wrong) {
          say(row(0, [badge("memcell"), warn("invalid URL")]), row(1, [label(wrong)]));
          return 1;
        }
        instance = normalize(customUrl);
      } else {
        instance = pickedInstance;
      }
    }

    // Owner & Project selection
    if (!targetProject) {
      let held = (await credentialFor(instance)) ? await whoami(instance).catch(() => null) : null;
      if (!held) {
        say(
          row(0, [badge("memcell"), place(instance)]),
          row(1, [label("signing in to this instance...")]),
        );
        const granted = await deviceGrant(instance, {
          noBrowser: options.noBrowser,
          retry: "memcell connect",
        });
        if (!granted) return 1;
        held = await whoami(instance).catch(() => null);
      }

      // Query organizations
      const orgsRes = await call<{
        organizations?: { id: string; name: string; slug: string }[];
      }>(instance, "/api/v1/organizations").catch(() => null);
      const orgs = orgsRes?.organizations ?? [];

      let selectedOwner: string | null = null;
      if (orgs.length > 0) {
        const personalLabel = held?.user
          ? held.user.isAnonymous
            ? "Personal"
            : `${held.user.name} (Personal)`
          : "Personal";
        const ownerChoices: Choice[] = [
          {
            name: "__personal__",
            label: personalLabel,
          },
          ...orgs.map((o) => ({
            name: o.slug,
            label: `${o.name} (${o.slug})`,
            note: "Organization",
          })),
        ];
        const pickedOwner = await choose("Select account or organization:", ownerChoices);
        if (!pickedOwner) return 0;
        selectedOwner = pickedOwner === "__personal__" ? null : pickedOwner;
      }

      // Query projects for that owner
      const projectsPath = selectedOwner ? `/api/v1/${selectedOwner}/projects` : "/api/v1/projects";
      const projectsRes = await call<{
        projects?: { id: string; name: string; slug: string; ownerSlug?: string }[];
      }>(instance, projectsPath).catch(() => null);
      const candidateProjects = projectsRes?.projects ?? [];

      const projectChoices: Choice[] = [
        ...candidateProjects.map((p) => {
          const fullSlug =
            p.ownerSlug && selectedOwner && p.ownerSlug !== selectedOwner
              ? `${p.ownerSlug}/${p.slug}`
              : p.slug;
          return {
            name: fullSlug,
            label: fullSlug,
            note: p.name !== p.slug ? p.name : undefined,
          };
        }),
        {
          name: "__new__",
          label: "+ Create new project...",
        },
      ];

      const pickedProj = await choose("Select project to connect:", projectChoices);
      if (!pickedProj) return 0;

      if (pickedProj === "__new__") {
        const defaultName = basename(process.cwd());
        const newName = await ask("Project name", defaultName);
        if (!newName) return 0;

        const body: Record<string, unknown> = { name: newName };
        if (selectedOwner) body.owner = selectedOwner;

        try {
          const res = await call<{
            ok?: boolean;
            project?: { id?: string; slug: string; name: string; ownerSlug?: string };
            slug?: string;
            name?: string;
            ownerSlug?: string;
          }>(instance, selectedOwner ? `/api/v1/${selectedOwner}/projects` : "/api/v1/projects", {
            method: "POST",
            body,
          });
          const proj = res.project ?? res;
          const slug = proj.slug;
          if (!slug) {
            say(
              row(0, [badge("memcell"), warn("could not resolve project slug")]),
              row(1, [label("Server responded without a project slug. Please try again.")]),
            );
            return 1;
          }
          const finalOwner = proj.ownerSlug || selectedOwner;
          targetProject = finalOwner ? `${finalOwner}/${slug}` : slug;
        } catch (error) {
          const failure = error as MemcellError;
          say(
            row(0, [badge("memcell"), warn("could not create project")]),
            row(1, [label(failure.message || "Failed to create project.")]),
          );
          return 1;
        }
      } else {
        targetProject =
          selectedOwner && !pickedProj.includes("/")
            ? `${selectedOwner}/${pickedProj}`
            : pickedProj;
      }
    }
  } else {
    // Non-interactive / Headless fallback
    if (!targetProject) {
      if (existing?.project?.owner && existing?.project?.project) {
        targetProject = `${existing.project.owner}/${existing.project.project}`;
      } else if (existing?.project?.project || existing?.project?.space) {
        targetProject = existing.project.project || existing.project.space;
      }
    }
  }

  // WHERE this is about to authenticate, said out loud when the directory
  // chose it. `.memcell` is committed and outranks this machine's own
  // config, so a cloned repository decides which host receives the device
  // grant and mints the key. That is fine when it is expected and worth
  // seeing when it is not — the host is named before anything is sent.
  if (options.from === "project") {
    say(
      row(
        0,
        [badge("memcell"), label("connecting to"), place(instance)],
        [label("(from directory .memcell)")],
      ),
    );
  }

  const here = basename(process.cwd());
  const present = [...(await detected())];
  const activeAgent = options.agent?.trim() || currentAgent() || present[0] || here;

  const models: Record<string, string> = {};
  for (const ag of present) {
    models[ag] = await resolveModelForAgent(ag, process.cwd());
  }
  const activeModel = await resolveModelForAgent(activeAgent, process.cwd());
  models[activeAgent] = activeModel;

  const identity = {
    agent: activeAgent,
    model: activeModel,
    agents: present,
    models,
    machine: hostname(),
  };

  let exchanged: Exchanged;
  try {
    if (pair) {
      exchanged = await call<Exchanged>(instance, "/api/v1/pair/claim", {
        method: "POST",
        // names which project/space of the caller's to reach, by slug
        body: {
          pair,
          ...identity,
          project: targetProject || undefined,
          space: targetProject || undefined,
        },
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
        body: {
          ...identity,
          project: targetProject || undefined,
          preferredProject: here,
          space: targetProject || undefined,
          preferredSpace: here,
        },
      });
    }
  } catch (error) {
    const failure = error as MemcellError;
    const body = failure.body as {
      error?: string;
      message?: string;
      projects?: { id: string; slug: string; name: string; ownerSlug?: string }[];
    } | null;

    if (
      failure.status === 409 &&
      body?.error === "multiple_projects" &&
      Array.isArray(body.projects)
    ) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [warn("multiple projects found")], [label("choose which one to connect:")]),
        ...body.projects.map((p) => {
          const display = p.ownerSlug ? `${p.ownerSlug}/${p.slug}` : p.slug;
          return row(2, [good(display)], [label(p.name)]);
        }),
        row(2, [label("run"), cmd("memcell connect [owner]/<slug>")]),
      );
      return 1;
    }

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
  const linked = exchanged.project || exchanged.space;
  const ownerSlug = exchanged.project?.ownerSlug || exchanged.space?.ownerSlug;
  const gitRoot = !existing ? await findGitRoot(process.cwd()) : null;
  const targetPath = existing?.at ?? (gitRoot ? join(gitRoot, PROJECT_FILE) : process.cwd());
  const at = await saveProject(
    {
      instance,
      owner: ownerSlug,
      project: linked.slug,
      projectId: linked.id,
      space: linked.slug,
      spaceId: linked.id,
    },
    targetPath,
  );
  const projectRoot = dirname(at);
  await pruneProjectKeys(instance, projectRoot, undefined, linked.id);
  await saveAgentKey({
    instance,
    keyId: exchanged.keyId,
    key: exchanged.key,
    project: projectRoot,
    projectId: linked.id,
    projectSlug: linked.slug,
    ownerSlug,
    projectPath: projectRoot,
    space: linked.slug,
    agentId: exchanged.agentId,
    agent: activeAgent,
  });

  if (exchanged.agents) {
    for (const [name, sub] of Object.entries(exchanged.agents)) {
      if (sub.keyId === exchanged.keyId) continue;
      await saveAgentKey({
        instance,
        keyId: sub.keyId,
        key: sub.key,
        project: projectRoot,
        projectId: linked.id,
        projectSlug: linked.slug,
        ownerSlug,
        projectPath: projectRoot,
        space: linked.slug,
        agentId: sub.agentId,
        agent: name,
      });
    }
  }

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

  const projectUrl = ownerSlug
    ? `${instance}/${ownerSlug}/${linked.slug}`
    : `${instance}/home?space=${linked.slug}`;

  const projectDisplay = ownerSlug ? `${ownerSlug}/${linked.slug}` : linked.slug;

  say(
    row(0, [badge("memcell"), good(`Connected to ${projectDisplay}`)]),
    row(1, [label("Directory".padEnd(11, " ")), place(dirname(at))]),
    wired.length > 0
      ? row(1, [label("Agents".padEnd(11, " ")), value(wired.join(", "))])
      : row(1, [label("Agents".padEnd(11, " ")), warn("none detected in this directory")]),
    wired.length > 0
      ? row(
          1,
          [label("Hooks".padEnd(11, " ")), good("Installed")],
          [label("(automatic memory recall before answers)")],
        )
      : null,
    refused.length > 0
      ? row(
          1,
          [label("Refused".padEnd(11, " ")), warn(refused.join(", "))],
          [label("(invalid JSON config)")],
        )
      : null,
    row(
      1,
      [label("Skill".padEnd(11, " ")), place(".agents/skills/memcell")],
      [label("(agent memory tools)")],
    ),
    row(1, [label("Dashboard".padEnd(11, " ")), place(projectUrl)]),
    !onPath &&
      row(
        1,
        [label("Warning".padEnd(11, " ")), warn("memcell is not on PATH")],
        [label("the hooks will not fire until it is")],
        [value("npm install -g memcell")],
      ),
    blank(),
    row(0, [label("Next:")]),
    row(1, [cmd("memcell status".padEnd(21, " ")), label("Verify agent connections and quotas")]),
    row(1, [cmd("memcell hook remove".padEnd(21, " ")), label("Disconnect local agent hooks")]),
    !targetProject &&
      row(1, [
        cmd("memcell connect --project <slug>".padEnd(21, " ")),
        label("Switch connected project"),
      ]),
    viaNpx() &&
      row(1, [cmd("npm install -g memcell".padEnd(21, " ")), label("Install CLI globally")]),
  );
  return 0;
}
