import type { Moment } from "../loop/moments.js";

// What one agent's harness CAN do, declared rather than inferred.
//
// This replaces a `Record<Moment, string>` per adapter — a map from one of
// memcell's moments to one event name. That shape carried a name and nothing
// else, so everything that actually differs between harnesses (whether the
// event takes a matcher, what its stdin looks like, how a reply reaches the
// model, whether it can refuse) lived as ad-hoc code somewhere in the
// adapter, where nothing could compare it against the next one.
//
// It had a worse fault. A missing key meant BOTH "this harness cannot" and
// "we never wired it", and those are opposite facts. Reading absence as
// incapacity is how thirteen harnesses that all document a pre-act event
// came to be described as four that do — the map was read as a statement
// about the agents when it was only ever a statement about us.
//
// So a capability is never absent here. It is either declared with how, or
// declared UNSUPPORTED WITH A REASON, and the reason has to be about the
// harness rather than about our backlog. The type will not let the question
// go unanswered.

/** Why memcell cannot do something on this agent — a fact about the harness,
 *  in words somebody can check. "Not built yet" is not one of these; that is
 *  our backlog, and it belongs in the tracker, not in a capability table. */
export interface Unsupported {
  unsupported: string;
}

export const unsupported = (why: string): Unsupported => ({ unsupported: why });

export const can = <T>(c: T | Unsupported): c is T => !(c as Unsupported)?.unsupported;

/** How a reply reaches the model at this event. Named because it differs:
 *  one harness reads a JSON field, another replaces the prompt outright, a
 *  third prepends through a plugin call. */
export type Inject =
  /** A JSON field on the hook's stdout, at this dotted path. */
  | { via: "json"; path: string }
  /** The reply REPLACES the prompt, so the dialect must echo the original
   *  back or the turn loses what the person typed. */
  | { via: "replaces-prompt" }
  /** A plugin API call rather than stdout. */
  | { via: "plugin"; call: string }
  /** Plain stdout, taken as context. */
  | { via: "stdout" };

/** How this harness lets a hook refuse the act it fired on. */
export type Refuse =
  | { via: "exit-code"; code: number }
  | { via: "json"; path: string; deny: string }
  | { via: "plugin"; call: string };

/** One thing memcell does, and how this harness does it. */
export interface At {
  /** The harness's own name for the event. Its spelling is its own — some
   *  are PascalCase, some camelCase, some dotted. */
  event: string;
  inject: Inject | Unsupported;
}

/**
 * The guard: memcell speaking at the moment an act is about to happen,
 * rather than once at the top of a session.
 *
 * `tools` is the piece that cannot live anywhere else. A statement records
 * WHEN it bears on an act in words every trade shares — read, change,
 * record, send, answer — and says nothing about tools, because the record
 * outlives whichever agents exist. Naming which of THIS agent's tools count
 * as sending is knowledge about one harness, and this is the file that is
 * allowed to know it.
 */
export interface Guard extends At {
  /** This harness's matcher expression for a set of its own tool names, or
   *  absent where it matches everything and the hook must filter. */
  matcher?: (tools: string[]) => string | undefined;
  refuse: Refuse | Unsupported;
  /** This agent's tool names, by the moment they belong to. A tool the
   *  adapter does not name is simply not guarded — silence, never a guess. */
  tools: Partial<Record<ActClass, string[]>>;
}

/** The five moments a standing rule can bear on. Mirrors the record's own
 *  vocabulary; the mapping from a tool name to one of these is per-agent and
 *  lives above, never in the record. */
export type ActClass = "read" | "change" | "record" | "send" | "answer";

/**
 * Everything memcell knows it can do on one agent.
 *
 * Every field is answered — with how, or with why not. A reviewer comparing
 * two adapters can see the difference without reading either one's code.
 */
export interface Surface {
  /** The lifecycle moments the loop already rides. */
  moments: Record<Moment, At | Unsupported>;
  /** Speaking at the moment of an act. */
  guard: Guard | Unsupported;
}
