import { COMMANDS, RESOURCES } from "./commands/index.js";
import { FLAGS, type Command } from "./model.js";
import { bad, cmd, label, render, row, text, value, variant, viaNpx, type Row } from "./ui.js";

// Help, generated from the same declarations the parser reads, and rendered
// through the same print system every command speaks with — the one way it
// stays impossible for help to describe a voice the CLI does not have.

const usage = (command: Command): string =>
  [
    "memcell",
    ...command.path,
    ...(command.args ?? []).map((a) =>
      a.required ? `<${a.name}${a.rest ? "…" : ""}>` : `[${a.name}${a.rest ? "…" : ""}]`,
    ),
  ].join(" ");

const pad = (t: string, width: number) => t + " ".repeat(Math.max(0, width - t.length));

function block(commands: Command[], depth: number): Row[] {
  const width = Math.max(...commands.map((c) => usage(c).length)) + 2;
  return commands.map((c) => row(depth, [cmd(pad(usage(c), width)), label(c.what)]));
}

interface Category {
  title: string;
  commands: string[];
}

const CATEGORIES: Category[] = [
  {
    title: "Lifecycle & Authentication",
    commands: ["login", "logout", "connect", "status", "reset", "pause", "resume"],
  },
  {
    title: "Agent Reasoning & Memory Loop",
    commands: ["recall", "remember", "report", "sweep", "import", "export", "hook remove"],
  },
  {
    title: "Epistemic Memory & Governance",
    commands: ["workspace", "memory", "scope", "promotion"],
  },
  {
    title: "Organizations, Teams & Agents",
    commands: ["org", "team", "collaborator", "agent", "fleet", "webhook"],
  },
  {
    title: "Platform Administration & Telemetry",
    commands: ["account", "usage", "insights", "audit", "config", "operator"],
  },
];

/** The bare screen. Complete categorized command surface. */
export function overview(): string {
  const categoryBlocks: { title: string; commands: Command[] }[] = [];
  const allCategoryCommands: Command[] = [];

  for (const cat of CATEGORIES) {
    const cmds: Command[] = [];
    for (const p of cat.commands) {
      const found = COMMANDS.find((c) => c.path.join(" ") === p && !c.hidden);
      if (found) {
        cmds.push(found);
        allCategoryCommands.push(found);
      }
    }
    if (cmds.length > 0) {
      categoryBlocks.push({ title: cat.title, commands: cmds });
    }
  }

  const width = Math.max(...allCategoryCommands.map((c) => usage(c).length)) + 2;

  const rows: Row[] = [
    row(0, [text("")]),
    row(0, [cmd("memcell"), label("— living memory for AI agents")]),
  ];

  for (const catBlock of categoryBlocks) {
    rows.push(row(0, [text("")]));
    rows.push(row(0, [label(catBlock.title)]));
    for (const c of catBlock.commands) {
      rows.push(row(0, [cmd(pad(usage(c), width)), label(c.what)]));
    }
  }

  rows.push(row(0, [text("")]));
  rows.push(
    row(
      0,
      [label("everything"), cmd("memcell <command> --help")],
      [
        label("options:"),
        // Only flags a PERSON's command takes. A flag that exists solely for
        // a hidden machine-facing command would advertise plumbing as API.
        label(
          [...new Set(COMMANDS.filter((c) => !c.hidden).flatMap((c) => c.takes ?? []))]
            .map((name) => `--${name}`)
            .join(" "),
        ),
      ],
    ),
  );

  if (viaNpx()) {
    rows.push(
      row(
        0,
        [label("keep it"), value("npm install -g memcell")],
        [label("after that it is just"), value("memcell")],
      ),
    );
  }

  rows.push(row(0, [text("")]));

  return render(rows);
}

/** One command, or one resource's verbs. */
export function detail(topic: string): string {
  const matching = COMMANDS.filter((c) => c.path[0] === topic && !c.hidden);
  if (matching.length === 0) return overview();

  const flags = [...new Set(matching.flatMap((c) => c.takes ?? []))].map(
    (name) => FLAGS[name] ?? { name, what: "" },
  );
  const width =
    Math.max(...flags.map((f) => (f.takes ? `--${f.name} <${f.takes}>` : `--${f.name}`).length)) +
    2;

  return render([
    row(0, [text("")]),
    ...block(matching, 0),
    ...(flags.length > 0
      ? [
          row(0, [text("")]),
          row(0, [label("options")]),
          ...flags.map((f) =>
            row(
              0,
              [
                cmd(pad(f.takes ? `--${f.name} <${f.takes}>` : `--${f.name}`, width)),
                label(f.what),
              ],
              f.env ? [variant(`env: ${f.env}`)] : null,
            ),
          ),
        ]
      : []),
    row(0, [text("")]),
  ]);
}

/** A refusal, in the CLI's own voice rather than a bare line on stderr. */
export function refusal(message: string, hint?: string): string {
  return [
    render([row(0, [text("")]), row(0, [bad(message)])]),
    hint ? detail(hint) : overview(),
  ].join("\n");
}
