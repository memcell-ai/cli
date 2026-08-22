// The terminal voice — one print system, used by every command.
//
// The reference is a status line: the mark and name opening the block, glyph-fronted
// readings, bold values against dim labels, italic modes, a block meter with
// its counts beside it, muted gold for time and money, and dim dots between
// groups. Dense lines where every segment carries its ROLE in its colour, so
// a glance sorts a line before it is read.
//
// Commands never assemble strings or pick colours. They describe lines as
// SEGMENTS — each one typed by what it IS (a value, a label, a state, a
// meter) — at a DEPTH, and the renderer decides how that looks, once. That
// is the whole point: the moment two commands render the same kind of thing
// differently, the voice is gone.
//
//   say(
//     row(0, [badge("memcell"), place(instance)]),
//     row(1, [state("good", "connected")], [label("to"), value("avalon")]),
//     row(2, [label("undo with"), cmd("memcell hook remove")]),
//   );
//
// Depth is hierarchy, not decoration: 0 = identity, 1 = readings, 2+ =
// detail under the reading above it. Groups within a row are separated by a
// dim dot; segments within a group by a space.
//
// Colour only when a person is watching a terminal that supports it — piped
// output and NO_COLOR get plain text, because this output gets grepped and
// pasted into issues.

const enabled =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code: string) => (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);

// ── the palette, by role — never used directly by commands ───────────────
const ROLE = {
  /** The product's ember, as close as 256-colour gets to #de8a33. */
  ember: paint("38;5;173"),
  emberBold: paint("1;38;5;173"),
  /** A value worth the eye: bold, bright. */
  value: paint("1;38;5;253"),
  /** A label: quiet, before its value. */
  label: paint("2"),
  /** A mode, a branch, a variant: italic violet — secondary identity. */
  variant: paint("3;38;5;146"),
  /** Emphasis state (the ✦ high of the reference): magenta. */
  accent: paint("1;38;5;175"),
  /** Time, durations, money: muted gold. */
  gold: paint("38;5;143"),
  good: paint("38;5;114"),
  warn: paint("38;5;179"),
  bad: paint("38;5;167"),
  faint: paint("38;5;242"),
  dim: paint("2"),
} as const;

/** The marks that say what KIND of reading follows. */
/** The product's mark: a bordered square with its diagonal cells filled,
 *  in the amber. `▧` is that drawing at terminal resolution — the border
 *  and the upper-left-to-lower-right fill in one glyph. */
export const MARK = "▧";

export const GLYPH = {
  meter: "◆",
  live: "✦",
  note: "·",
  ok: "✓",
  bad: "✕",
  wait: "◇",
  pen: "✎",
} as const;

// ── the segment model ────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "bad" | "accent" | "neutral";

export type Seg =
  /** Identity: the mark, then the name. */
  | { k: "badge"; t: string }
  /** Where something lives — a path, an instance, a host. */
  | { k: "place"; t: string }
  /** A value worth the eye. */
  | { k: "value"; t: string }
  /** A quiet label, usually before a value. */
  | { k: "label"; t: string }
  /** Italic secondary identity: a mode, a branch, a capability list. */
  | { k: "variant"; t: string }
  /** A state word with its glyph and tone: `✓ linked`, `✕ refused`. */
  | { k: "state"; tone: Tone; t: string; glyph?: string }
  /** A block meter with its reading beside it. */
  | { k: "meter"; value: number; total: number; reading?: string }
  /** A colour chip — a standalone square signal. */
  | { k: "chip"; tone: Tone }
  /** A duration or timestamp, in the muted gold of the reference. */
  | { k: "time"; t: string }
  /** An identifier: present, faint, never the point. */
  | { k: "id"; t: string }
  /** A command the person can type. */
  | { k: "cmd"; t: string }
  /** Several things of ONE kind. Joined with commas, because the dot
   *  separates FIELDS — a list dotted like its neighbours reads as one long
   *  run of unrelated words, which is exactly how "claude · gemini · recall"
   *  came to look like a single list of six. */
  | { k: "list"; items: string[] }
  /** Plain text in the default ink. */
  | { k: "text"; t: string };

export interface Row {
  depth: number;
  groups: Seg[][];
  /** Free-form metadata; carried through render for callers that post-process
   *  (tests, a future JSON mode) and ignored by the terminal renderer. */
  meta?: Record<string, unknown>;
}

// ── the builders commands actually write ─────────────────────────────────

export const badge = (t: string): Seg => ({ k: "badge", t });
export const place = (t: string): Seg => ({ k: "place", t });
export const value = (t: string): Seg => ({ k: "value", t });
export const label = (t: string): Seg => ({ k: "label", t });
export const variant = (t: string): Seg => ({ k: "variant", t });
export const time = (t: string): Seg => ({ k: "time", t });
export const id = (t: string): Seg => ({ k: "id", t });
/** Whether this process was run through npx rather than an installed
 *  binary — npm sets `npm_command=exec` for `npx`, and the script lands
 *  in an `_npx` cache dir. A hint that says `memcell connect` to an npx
 *  caller points at a command that does not exist on their machine. */
export const viaNpx = (): boolean =>
  /npx-cli\.js$/.test(process.env.npm_execpath ?? "") || (process.argv[1] ?? "").includes("_npx");

export const cmd = (t: string): Seg => ({
  k: "cmd",
  t: viaNpx() && t.startsWith("memcell") ? t.replace(/^memcell/, "npx memcell@latest") : t,
});
export const text = (t: string): Seg => ({ k: "text", t });
export const chip = (tone: Tone): Seg => ({ k: "chip", tone });
export const list = (items: string[]): Seg => ({ k: "list", items });

export const state = (tone: Tone, t: string, glyph?: string): Seg => ({
  k: "state",
  tone,
  t,
  glyph,
});
export const good = (t: string): Seg => state("good", t, GLYPH.ok);
export const warn = (t: string): Seg => state("warn", t);
export const bad = (t: string): Seg => state("bad", t, GLYPH.bad);
export const accent = (t: string): Seg => state("accent", t, GLYPH.live);

export const meter = (v: number, total: number, reading?: string): Seg => ({
  k: "meter",
  value: v,
  total,
  reading,
});

/** One row at a depth. Falsy groups and falsy segments vanish, so callers
 *  write conditionals inline without dangling separators.
 *
 *  A badge always becomes its own group: the mark and the name are identity,
 *  and identity is separated from what follows it by the same dot every other
 *  pair on the line gets. Doing it here rather than at the call sites means
 *  the rule holds for every command at once, and a new one cannot forget it. */
export function row(depth: number, ...groups: (Seg | Seg[] | null | undefined | false)[]): Row {
  const kept: Seg[][] = [];
  for (const group of groups) {
    if (!group) continue;
    const segs = (Array.isArray(group) ? group : [group]).filter(Boolean) as Seg[];
    if (segs.length === 0) continue;
    if (segs[0]!.k === "badge" && segs.length > 1) {
      kept.push([segs[0]!], segs.slice(1));
    } else {
      kept.push(segs);
    }
  }
  return { depth, groups: kept };
}

// ── the renderer — the only place any of this becomes a string ───────────

const TONE_PAINT: Record<Tone, (t: string) => string> = {
  good: ROLE.good,
  warn: ROLE.warn,
  bad: ROLE.bad,
  accent: ROLE.accent,
  neutral: ROLE.dim,
};

const TONE_GLYPH: Record<Tone, string> = {
  good: GLYPH.ok,
  // Its own mark, not the note dot: a warning fronted by `·` reads as a
  // bullet, so the line looks like a list item rather than a caution.
  warn: "!",
  bad: GLYPH.bad,
  accent: GLYPH.live,
  neutral: "",
};

/** The block meter of the reference: filled is what happened, hollow what
 *  has not, and the first earned block draws dim rather than not at all —
 *  hours of real work must never look like a hung process. */
function blocks(valueNow: number, total: number, width = 14): string {
  if (total <= 0) return ROLE.dim("▱".repeat(width));
  const ratio = Math.min(Math.max(valueNow / total, 0), 1);
  const whole = Math.min(width, Math.floor(ratio * width));
  const partial = whole < width && ratio * width - whole > 1e-9 ? 1 : 0;
  return (
    ROLE.ember("▰".repeat(whole)) +
    (partial ? ROLE.dim("▰") : "") +
    ROLE.dim("▱".repeat(Math.max(0, width - whole - partial)))
  );
}

function segText(seg: Seg): string {
  switch (seg.k) {
    case "badge":
      return `${ROLE.ember(MARK)} ${ROLE.emberBold(seg.t)}`;
    case "place":
      return ROLE.ember(seg.t);
    case "value":
      return ROLE.value(seg.t);
    case "label":
      return ROLE.label(seg.t);
    case "variant":
      return ROLE.variant(seg.t);
    case "state": {
      const glyph = seg.glyph ?? TONE_GLYPH[seg.tone];
      return TONE_PAINT[seg.tone](glyph ? `${glyph} ${seg.t}` : seg.t);
    }
    case "meter": {
      const bar = blocks(seg.value, seg.total);
      return seg.reading ? `${bar} ${ROLE.value(seg.reading)}` : bar;
    }
    case "chip":
      return TONE_PAINT[seg.tone]("▪");
    case "time":
      return ROLE.gold(seg.t);
    case "id":
      return ROLE.faint(seg.t);
    case "cmd":
      return ROLE.emberBold(seg.t);
    case "list":
      return seg.items.map((i) => ROLE.value(i)).join(ROLE.dim(", "));
    case "text":
      return seg.t;
  }
}

const DOT = ROLE.dim(" · ");

export function render(rows: (Row | null | undefined | false)[]): string {
  const out: string[] = [];
  for (const r of rows) {
    if (!r || r.groups.length === 0) continue;
    const indent = "  ".repeat(r.depth);
    out.push(indent + r.groups.map((g) => g.map(segText).join(" ")).join(DOT));
  }
  return out.join("\n");
}

/** Print a block: one blank line of air on each side, exactly once. */
export function say(...rows: (Row | null | undefined | false)[]): void {
  const body = render(rows);
  if (body.length === 0) return;
  console.log(`\n${body}\n`);
}

/** A document on stdout, raw and unix-shaped, so it pipes. The one way a
 *  command hands over a payload rather than speaking — its receipt goes
 *  through `aside`, where it cannot corrupt what this wrote. */
export function emit(payload: string): void {
  process.stdout.write(payload);
}

/** The same voice on stderr, for a command whose stdout belongs to a
 *  protocol (the MCP bridge). One renderer, two channels — never a second
 *  way of wording things. */
export function aside(...rows: (Row | null | undefined | false)[]): void {
  const body = render(rows);
  if (body.length === 0) return;
  process.stderr.write(`\n${body}\n\n`);
}

// ── live lines (watching work) ───────────────────────────────────────────

/** The bar alone, as a string — for live lines that compose it themselves
 *  and for the tests that pin its block arithmetic. */
export const bar = blocks;

/** A meter for work with no countable end — it breathes rather than fills. */
export function pending(width = 14, tick = 0): string {
  const at = tick % width;
  return ROLE.dim("▱".repeat(at)) + ROLE.ember("▰") + ROLE.dim("▱".repeat(width - at - 1));
}

/** Rewrite the current terminal line in place. */
export function repaint(rowNow: Row): void {
  if (!enabled) return;
  process.stdout.write(`\r\x1b[2K${render([rowNow])}`);
}

export function clearLine(): void {
  if (enabled) process.stdout.write("\r\x1b[2K");
}

/**
 * A short human reading of a duration — "45s", "1m 30s", "4h 12m".
 * Downstream surfaces print the same values; the table in test/ui.test.ts
 * is the contract they hold to.
 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** A percentage, right-weighted so a changing number does not jitter. */
export const percent = (ratio: number): string =>
  ROLE.value(`${String(Math.round(ratio * 100)).padStart(2, " ")}%`);

export const rule = (): string => ROLE.dim("─".repeat(46));
