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

/** The bare screen. Three commands tell the story; the rest are a nudge. */
export function overview(): string {
  const landing = COMMANDS.filter((c) => c.landing && !c.hidden);
  const nounWidth = Math.max(...RESOURCES.map((r) => r.name.length)) + 2;

  return render([
    row(0, [text("")]),
    row(0, [cmd("memcell"), label("— living memory for AI agents")]),
    row(0, [text("")]),
    ...block(landing, 0),
    row(0, [text("")]),
    row(0, [label("then, by what you are acting on")]),
    ...RESOURCES.map((r) => row(0, [cmd(pad(r.name, nounWidth)), label(r.what)])),
    row(0, [text("")]),
    row(
      0,
      [label("everything"), cmd("memcell --help <name>")],
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
    viaNpx() &&
      row(
        0,
        [label("keep it"), value("npm install -g memcell")],
        [label("after that it is just"), value("memcell")],
      ),
    row(0, [text("")]),
  ]);
}

/** One command, or one resource's verbs. */
export function detail(topic: string): string {
  const matching = COMMANDS.filter((c) => c.path[0] === topic && !c.hidden);
  if (matching.length === 0) return overview();

  const flags = [...new Set(matching.flatMap((c) => c.takes ?? []))].map((name) => FLAGS[name]!);
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
