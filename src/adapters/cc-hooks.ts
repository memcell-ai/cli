import { resolve } from "node:path";

import { hookCommand, hookMatches, MOMENTS, type Moment } from "../loop/moments.js";
import { ours, readJson, writeJson, type Wiring } from "./shared.js";

// The Claude-shaped hooks block, written once for the half of the field
// that speaks it. Muse, Droid, Qwen, Devin and Claude Code itself all
// register hooks as the same nested JSON — an event name mapping to
// `[{ matcher?, hooks: [{ type: "command", command, timeout }] }]` — inside
// some settings file; what differs per agent is only WHERE that file lives
// and WHAT its four events are called. An adapter hands those two facts in
// and gets install/remove/verify back, so the merge discipline (never
// touch anybody else's entries; refresh our own in place) exists exactly
// once.

interface Entry {
  matcher?: string;
  hooks?: { type: string; command: string; timeout?: number }[];
}

interface HookedFile {
  hooks?: Record<string, Entry[]>;
  [k: string]: unknown;
}

export interface CcHookOps {
  stale(projectDir: string): Promise<boolean>;
  install(projectDir: string): Promise<string>;
  remove(projectDir: string): Promise<string | null>;
  verify(projectDir: string): Promise<Wiring[]>;
}

export function ccHookOps(
  program: string,
  file: (projectDir: string) => string,
  EVENT: Record<Moment, string>,
  extras?: {
    /** Runs after the hooks are written — the place an adapter registers
     *  its MCP entry or anything else that travels with the wiring. */
    afterInstall?: (projectDir: string) => Promise<void>;
    /** Removes whatever afterInstall added; true when something was held. */
    alsoRemove?: (projectDir: string) => Promise<boolean>;
    /** "bare" when the file IS the events map (devin's hooks.v1.json),
     *  rather than a settings document with a `hooks` key. */
    shape?: "nested" | "bare";
    /** Files an OLDER release wired, which this one no longer uses. Ours
     *  are swept out of them on every install, so an upgrade migrates
     *  itself and nothing is left to fire twice. Never created, never
     *  touched beyond our own entries. */
    legacy?: (projectDir: string) => string[];
  },
): CcHookOps {
  const bare = extras?.shape === "bare";
  // One view over both file shapes: `events()` is the map the four moments
  // live in, wherever the file keeps it.
  const load = async (
    at: string,
  ): Promise<{ doc: HookedFile; events: Record<string, Entry[]> }> => {
    const doc = await readJson<HookedFile>(at);
    if (bare) return { doc, events: doc as unknown as Record<string, Entry[]> };
    doc.hooks ??= {};
    return { doc, events: doc.hooks };
  };

  /** Take our own entries out of a file, leaving everyone else's. Returns
   *  whether anything was there. */
  const sweep = async (at: string): Promise<boolean> => {
    const { doc, events } = await load(at);
    let changed = false;
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const before = entry.hooks?.length ?? 0;
        if (entry.hooks) entry.hooks = entry.hooks.filter((h) => !ours(h.command));
        if ((entry.hooks?.length ?? 0) !== before) changed = true;
      }
      events[event] = entries.filter((e) => (e.hooks?.length ?? 0) > 0);
      if (events[event].length === 0) delete events[event];
    }
    if (changed) await writeJson(at, bare ? events : doc);
    return changed;
  };

  return {
    /** Ours, but not as this build writes it — an older release's shape. */
    async stale(projectDir: string): Promise<boolean> {
      const dir = resolve(projectDir);
      for (const at of extras?.legacy?.(dir) ?? []) {
        if (at === file(dir)) continue;
        const { events } = await load(at);
        const held = Object.values(events).some(
          (entries) =>
            Array.isArray(entries) &&
            entries.some((e) => (e.hooks ?? []).some((h) => ours(h.command))),
        );
        if (held) return true;
      }
      const { events } = await load(file(dir));
      for (const moment of MOMENTS) {
        for (const entry of events[EVENT[moment]] ?? []) {
          for (const h of entry.hooks ?? []) {
            if (
              hookMatches(h.command, moment, program) &&
              h.command !== hookCommand(moment, program)
            ) {
              return true;
            }
          }
        }
      }
      // A moment this release fires at that the wiring has never heard of.
      // Everything above catches wiring of the wrong SHAPE; this catches
      // wiring of the right shape that simply predates a moment, which is
      // what every upgrade adding one leaves behind — hooks that are
      // current, portable, and quietly one moment short.
      //
      // Wired means wired for what we fire NOW, so the first hook after an
      // upgrade carries itself forward and nobody has to be told.
      const wired = new Set(
        MOMENTS.filter((moment) =>
          (events[EVENT[moment]] ?? []).some((entry) =>
            (entry.hooks ?? []).some((h) => ours(h.command)),
          ),
        ),
      );
      if (wired.size > 0 && wired.size < MOMENTS.length) return true;
      return false;
    },

    async install(projectDir: string): Promise<string> {
      const at = file(resolve(projectDir));
      const { doc, events } = await load(at);
      const settings = { hooks: events };
      for (const moment of MOMENTS) {
        const entries = (settings.hooks[EVENT[moment]] ??= []);
        const command = hookCommand(moment, program);
        // Merge never clobbers OTHER entries; our own is refreshed in
        // place. A re-connect mints a new agent identity, and a hook left
        // carrying the old one reports a dead agent on every firing.
        let held = false;
        for (const entry of entries) {
          for (const h of entry.hooks ?? []) {
            if (hookMatches(h.command, moment, program)) {
              h.command = command;
              held = true;
            }
          }
        }
        if (!held) entries.push({ hooks: [{ type: "command", command, timeout: 30 }] });
      }
      await writeJson(at, bare ? settings.hooks : doc);
      // An older release wired somewhere else. Take ours out of there in
      // the same breath: two live wirings would fire the loop twice a turn.
      for (const stale of extras?.legacy?.(resolve(projectDir)) ?? []) {
        if (stale !== at) await sweep(stale);
      }
      await extras?.afterInstall?.(resolve(projectDir));
      return at;
    },

    async remove(projectDir: string): Promise<string | null> {
      const at = file(resolve(projectDir));
      const unwired = (await extras?.alsoRemove?.(resolve(projectDir))) ?? false;
      const { doc, events } = await load(at);
      let changed = false;
      for (const [event, entries] of Object.entries(events)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const before = entry.hooks?.length ?? 0;
          if (entry.hooks) entry.hooks = entry.hooks.filter((h) => !ours(h.command));
          if ((entry.hooks?.length ?? 0) !== before) changed = true;
        }
        events[event] = entries.filter((e) => (e.hooks?.length ?? 0) > 0);
        if (events[event].length === 0) delete events[event];
      }
      if (!changed) return unwired ? at : null;
      await writeJson(at, bare ? events : doc);
      return at;
    },

    async verify(projectDir: string): Promise<Wiring[]> {
      const { events } = await load(file(resolve(projectDir)));
      return MOMENTS.map((moment) => ({
        moment,
        event: EVENT[moment],
        ok: Boolean(
          events[EVENT[moment]]?.some?.((e) =>
            e.hooks?.some((h) => hookMatches(h.command, moment, program)),
          ),
        ),
      }));
    },
  };
}
