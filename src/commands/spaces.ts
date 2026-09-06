import { call, MemcellError } from "../client.js";
import { credentialFor } from "../instance.js";
import { findProject } from "../project.js";
import { badge, cmd, good, label, place, row, say, value, variant, warn } from "../ui.js";

// Spaces, and which one you are working on.
//
// `use` is the one worth explaining. The active space is a preference on
// the PERSON, held by the instance and read by every surface — so this
// writes the same field the switcher in the app writes, and the terminal
// and the browser cannot end up disagreeing about where a statement landed.
// A CLI that kept its own idea of "current space" would be a second answer
// to a question that must have one.
//
// A wired directory is different and does not move: `connect` records its
// space, and a project files where it was wired regardless of what anybody
// switched to since. That is the point of linking, so `use` says when the
// two differ rather than letting somebody assume it changed both.

interface Me {
  activeSpace: { slug: string; name: string } | null;
}

interface SpacePage {
  items: { slug: string; name: string }[];
  next_cursor: string | null;
}

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

export async function listSpaces(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    // The index, not `/me`. A person's spaces were embedded in the account
    // and there was no collection to walk — so the only way to learn a slug
    // was to have made it. `/api/v1/spaces` paginates; this walks it whole
    // because a list a person reads is a list they want all of.
    const [me, spaces] = await Promise.all([
      call<Me>(instance, "/api/v1/me"),
      (async () => {
        const all: { slug: string; name: string }[] = [];
        let cursor: string | null = null;
        do {
          const page: SpacePage = await call<SpacePage>(
            instance,
            `/api/v1/spaces?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          );
          all.push(...page.items);
          cursor = page.next_cursor;
        } while (cursor);
        return all;
      })(),
    ]);
    if (spaces.length === 0) {
      say(
        row(0, [badge("memcell"), place(instance)]),
        row(1, [label("no spaces")], [label("make one with"), cmd("memcell spaces new <name>")]),
      );
      return 0;
    }

    const here = (await findProject())?.project;
    say(
      row(0, [badge("memcell"), place(instance)], [variant(`${spaces.length}`)]),
      ...spaces.map((s) =>
        row(
          1,
          [s.slug === me.activeSpace?.slug ? good(s.slug) : value(s.slug)],
          [label(s.name)],
          s.slug === me.activeSpace?.slug && [variant("active")],
          s.slug === here?.space && [variant("linked here")],
        ),
      ),
      row(2, [label("work on one with"), cmd("memcell spaces use <slug>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

export async function newSpace(instance: string, name: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const { slug } = await call<{ slug: string }>(instance, "/api/v1/spaces", {
      method: "POST",
      body: { name },
    });
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("made")], [value(slug)], [label(name)]),
      // Empty, and said so — a new space that looked ready would be the
      // first thing anybody wired an agent to and the first to disappoint.
      row(2, [label("empty until something files into it")]),
      row(2, [label("make it active with"), cmd(`memcell spaces use ${slug}`)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

export async function useSpace(instance: string, slug: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const { activeSpace } = await call<{ activeSpace: { slug: string; name: string } }>(
      instance,
      "/api/v1/me",
      { method: "PATCH", body: { space: slug } },
    );

    const here = (await findProject())?.project;
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [good("working on")], [value(activeSpace.name)], [label(activeSpace.slug)]),
      // The correction that stops a silent surprise: switching does not
      // move a wired directory, and somebody standing in one has every
      // reason to assume it did.
      here && here.space !== activeSpace.slug
        ? row(
            2,
            [label("this directory stays connected to"), value(here.space)],
            [label("reconnect it with"), cmd("memcell connect")],
          )
        : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as MemcellError);
  }
}

function refused(instance: string, failure: MemcellError): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}
