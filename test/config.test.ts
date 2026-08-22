import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { saveProject } from "../src/project.js";

// Settings live in two files with one precedence, and what is pinned here is
// that precedence plus the two ways a settings command lies: writing to the
// scope you did not name, and reporting a value some other file is actually
// overriding.

const home = await mkdtemp(join(tmpdir(), "memcell-config-home-"));
const project = await mkdtemp(join(tmpdir(), "memcell-config-proj-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const cwd = process.cwd;
beforeAll(async () => {
  await saveProject({ instance: "http://localhost:3100", space: "api" }, project);
  process.cwd = () => project;
  return () => {
    process.cwd = cwd;
  };
});

const config = await import("../src/config.js");
const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const { findProject } = await import("../src/project.js");

describe("precedence", () => {
  it("the project wins over the machine", async () => {
    await config.set("recall.limit", 12, "global");
    await config.set("recall.limit", 5, "project");

    const found = await config.get("recall.limit");
    expect(found?.value).toBe(5);
    expect(found?.scope).toBe("project");
  });

  it("falls through to the machine for anything the project does not say", async () => {
    await config.set("recall.deadlineMs", 4000, "global");
    const found = await config.get("recall.deadlineMs");
    expect(found?.value).toBe(4000);
    expect(found?.scope).toBe("global");
  });

  it("answers nothing for a key nobody set", async () => {
    expect(await config.get("nothing.here")).toBeNull();
  });

  it("reads one scope alone when asked, ignoring what would otherwise win", async () => {
    const global = await config.get("recall.limit", { only: "global" });
    expect(global?.value).toBe(12);
    expect(global?.scope).toBe("global");
  });
});

describe("what goes where", () => {
  it("writes the project's settings into the project's own file", async () => {
    await config.set("landing.scope", "team", "project");
    // The setting reads back through the resolver…
    expect((await config.get("landing.scope"))?.value).toBe("team");
    // …and the connection it sits beside is untouched.
    const found = await findProject(project);
    expect(found?.project.space).toBe("api");
  });

  it("writes the machine's settings into the machine's own file", async () => {
    const file = await readJson(join(home, ".memcell", "config.json"));
    expect(file.recall.limit).toBe(12);
  });

  it("upserts a project write where nothing is connected yet — no error", async () => {
    // config is upsert: a plain folder is not an error to write a setting
    // into, it is a folder that does not have the file yet. --global stays
    // the deliberate machine write; the bare form always lands in the project.
    const elsewhere = await mkdtemp(join(tmpdir(), "memcell-fresh-"));
    process.cwd = () => elsewhere;
    const file = await config.set("recall.limit", 1, "project");
    expect(file).toBe(join(elsewhere, ".memcell"));
    expect((await config.get("recall.limit"))?.value).toBe(1);
    process.cwd = () => project;
  });

  it("walks past the machine's own data directory — same name, not a project file", async () => {
    // The real machine keeps its data in a `.memcell` DIRECTORY in the home,
    // and every project lives somewhere under the home. An unconnected
    // project's upward walk reaches that directory, and taking it for the
    // project file means opening a directory as TOML: EISDIR, from a plain
    // `config set` with no --global anywhere near it.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(home, ".memcell"), { recursive: true });
    const nested = join(home, "projects", "app");
    await mkdir(nested, { recursive: true });
    process.cwd = () => nested;
    const file = await config.set("instance.url", "http://localhost:3000", "project");
    expect(file).toBe(join(nested, ".memcell"));
    expect((await config.get("instance.url", { only: "project" }))?.value).toBe(
      "http://localhost:3000",
    );
    process.cwd = () => project;
  });

  it("keeps both files readable by their owner only", async () => {
    const { stat } = await import("node:fs/promises");
    expect((await stat(join(project, ".memcell"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, ".memcell", "config.json"))).mode & 0o777).toBe(0o600);
  });
});

describe("dotted paths", () => {
  it("nests rather than storing the dots as a key", async () => {
    await config.set("a.b.c", "deep", "global");
    const file = await readJson(join(home, ".memcell", "config.json"));
    expect(file.a.b.c).toBe("deep");
    expect(file["a.b.c"]).toBeUndefined();
  });

  it("answers not-set rather than throwing when a path runs through a value", async () => {
    await config.set("scalar", "x", "global");
    expect(await config.get("scalar.deeper")).toBeNull();
  });
});

describe("values", () => {
  it("reads what looks like a number, a boolean or null as itself", () => {
    expect(config.read("12")).toBe(12);
    expect(config.read("true")).toBe(true);
    expect(config.read("null")).toBeNull();
  });

  it("leaves everything else exactly as typed", () => {
    // A path or a slug must not be mangled on its way to disk.
    expect(config.read("~/some/path")).toBe("~/some/path");
    expect(config.read("payments-api")).toBe("payments-api");
    expect(config.read("12x")).toBe("12x");
  });

  it("prints strings without quotes and everything else as it is stored", () => {
    expect(config.show("team")).toBe("team");
    expect(config.show(12)).toBe("12");
    expect(config.show(true)).toBe("true");
  });
});

describe("one chain, every source", () => {
  it("a flag beats everything", async () => {
    await config.set("instance", "http://from-global", "global");
    await config.set("instance", "http://from-project", "project");
    const found = await config.get("instance", { flag: "http://from-flag" });
    expect(found?.value).toBe("http://from-flag");
    expect(found?.scope).toBe("flag");
  });

  it("the environment beats the files", async () => {
    process.env.MEMCELL_INSTANCE = "http://from-env";
    const found = await config.get("instance");
    expect(found?.value).toBe("http://from-env");
    expect(found?.scope).toBe("env");
    delete process.env.MEMCELL_INSTANCE;
  });

  it("and neither reaches a scope asked for by name", async () => {
    // `--global` means "tell me what the machine says", not "tell me what
    // wins" — a settings command that could not answer that could not be
    // used to debug precedence at all.
    process.env.MEMCELL_INSTANCE = "http://from-env";
    const found = await config.get("instance", { only: "global" });
    expect(found?.value).toBe("http://from-global");
    delete process.env.MEMCELL_INSTANCE;
  });

  it("reads a key under a spelling written before its alias existed", async () => {
    // `url` was accepted, stored, and then canonicalised to `instance`. A
    // settings file that stops reading what it once accepted has silently
    // lost somebody's setting.
    await config.set("legacy.only", "kept", "global");
    const { writeFile: w, readFile: r } = await import("node:fs/promises");
    const file = join(home, ".memcell", "config.json");
    const tree = JSON.parse(await r(file, "utf8"));
    delete tree.instance;
    tree.url = "http://written-as-url";
    await w(file, JSON.stringify(tree));

    const found = await config.get("url", { only: "global" });
    expect(found?.value).toBe("http://written-as-url");
    // and the canonical name finds it too
    expect((await config.get("instance", { only: "global" }))?.value).toBe("http://written-as-url");
  });

  it("stores an alias under the canonical path", async () => {
    // url and instance both mean [instance].url — the same place the
    // connection uses. Written via any spelling, read via any spelling.
    await config.set("url", "http://written-via-alias", "global");
    const file = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(home, ".memcell", "config.json"), "utf8"),
    );
    expect(file.instance.url).toBe("http://written-via-alias");
  });
});
