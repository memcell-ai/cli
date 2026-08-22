import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import { render, row, cmd, label, text, value, variant } from "./ui.js";

// A multi-select, in the CLI's own voice.
//
// It is only ever offered when a person is watching a terminal that can
// answer: with no TTY — CI, a pipe, a script — there is nobody to ask, and
// asking would hang a build forever. Callers get `null` there and decide
// what silence means, rather than this guessing on their behalf.

export interface Choice {
  name: string;
  label: string;
  /** Shown beside the row: why it is preselected, or why it is not. */
  note?: string;
  picked?: boolean;
}

const CAN_ASK = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true && !process.env.CI;

/**
 * A yes/no, for a destructive command that would rather ask than refuse.
 *
 * Returns `null` where there is nobody to ask — a pipe, a script, CI — so a
 * caller can require an explicit flag there instead of hanging a build on a
 * prompt nothing will answer. Default is no: an empty line, anything that is
 * not a clear yes, leaves things as they are.
 */
export async function confirm(question: string): Promise<boolean | null> {
  if (!CAN_ASK()) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function draw(choices: Choice[], cursor: number, picked: Set<string>, first: boolean): void {
  if (!first) process.stdout.write(`\x1b[${choices.length + 2}A`);
  const lines = [
    row(1, [label("space toggles · enter confirms · a picks all")]),
    ...choices.map((c, i) =>
      row(
        1,
        // The mark and the name are one field: a dot between them would read
        // as two things rather than one row's state.
        [text(picked.has(c.name) ? "◉" : "○"), i === cursor ? value(c.label) : label(c.label)],
        c.note ? [variant(c.note)] : null,
      ),
    ),
  ];
  process.stdout.write(`\x1b[0J${render(lines)}\n\n`);
}

/**
 * Ask which of these to act on. Returns the chosen names, or null when
 * there is nobody to ask.
 */
export async function pick(title: string, choices: Choice[]): Promise<string[] | null> {
  if (choices.length === 0) return [];
  if (!CAN_ASK()) return null;

  const picked = new Set(choices.filter((c) => c.picked).map((c) => c.name));
  let cursor = 0;

  process.stdout.write(`\n${render([row(0, [cmd(title)])])}\n`);
  draw(choices, cursor, picked, true);

  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  try {
    return await new Promise<string[] | null>((resolve) => {
      const onKey = (_: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
        if (key.ctrl && key.name === "c") {
          stop();
          // Ctrl-C is not an answer — the caller sees "nobody chose" and
          // stops, rather than proceeding with a half-made selection.
          resolve(null);
          return;
        }
        if (key.name === "up") cursor = (cursor - 1 + choices.length) % choices.length;
        else if (key.name === "down") cursor = (cursor + 1) % choices.length;
        else if (key.name === "space") {
          const here = choices[cursor]!.name;
          picked.has(here) ? picked.delete(here) : picked.add(here);
        } else if (key.sequence === "a") {
          const all = picked.size === choices.length;
          picked.clear();
          if (!all) for (const c of choices) picked.add(c.name);
        } else if (key.name === "return") {
          stop();
          resolve(choices.filter((c) => picked.has(c.name)).map((c) => c.name));
          return;
        }
        draw(choices, cursor, picked, false);
      };

      const stop = () => {
        process.stdin.off("keypress", onKey);
        process.stdin.setRawMode(Boolean(wasRaw));
        process.stdin.pause();
      };

      process.stdin.on("keypress", onKey);
    });
  } catch {
    return null;
  }
}
