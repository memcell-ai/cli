import { mkdir, readFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = join(process.cwd(), ".memcell", "test-refusal-home");
// Outside the checkout: the project search climbs parents, so a directory
// inside a checkout can resolve to whatever wired directory sits above it —
// the hook would find that one and report it as wired.
const project = mkdtempSync(join(tmpdir(), "memcell-refusal-project-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const said: string[] = [];
vi.spyOn(console, "log").mockImplementation((line: unknown) => said.push(String(line)));
vi.spyOn(console, "error").mockImplementation((line: unknown) => said.push(String(line)));

const { badInstance } = await import("../src/instance.js");
const { logout } = await import("../src/commands/logout.js");
const { hook } = await import("../src/commands/hook.js");
const { machineFile } = await import("../src/machine.js");

// What the CLI does when nothing is set up, or something is set up wrong.
//
// These are the paths somebody meets on their worst day: a typo in a flag, a
// machine that was reset, a hook wired to a moment that does not exist. Every
// one of them used to end in silence, in a green tick for something that did
// not happen, or in an instruction to fix the wrong thing.

const out = () => said.join("\n");

beforeEach(async () => {
  said.length = 0;
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

describe("a flag that cannot be right", () => {
  it("refuses an instance that is not a URL, and says what one looks like", () => {
    // Carried down, a typo reached the sign-in check and came back as "not
    // signed in" — sending somebody to log in to something that cannot exist.
    expect(badInstance("not-a-url")).toContain("not a URL");
    expect(badInstance("not-a-url")).toContain("http://");
    expect(badInstance("ftp://memcell.ai")).toContain("http");
  });

  it("accepts the shapes an instance actually comes in", () => {
    expect(badInstance("http://localhost:3000")).toBeNull();
    expect(badInstance("https://memcell.ai")).toBeNull();
    expect(badInstance("https://memcell.ai/")).toBeNull();
  });
});

describe("nothing to undo", () => {
  it("says so rather than reporting success it did not have", async () => {
    // A green "signed out" for a machine that was never signed in is the
    // product agreeing with whatever you assumed.
    expect(await logout("http://localhost:3100")).toBe(0);
    expect(out()).toContain("not connected");
    expect(out()).not.toContain("signed out");
  });
});

describe("a hook wired wrong", () => {
  it("exits 0 on a moment that does not exist, and writes down that it did", async () => {
    // Exit 0 because this runs inside somebody's session and a typo in a
    // config file must never break their agent. Written down because silence
    // made it look exactly like a hook that was never installed — the one
    // pair the log exists to tell apart.
    expect(await hook("tea-time", "claude")).toBe(0);

    const log = await readFile(machineFile("hook.log"), "utf8");
    expect(log).toContain("not a moment");
    expect(log).toContain("session-start");
  });

  it("exits 0 on junk arriving where the payload should be", async () => {
    await mkdir(project, { recursive: true });
    const stdin = {
      isTTY: false,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from("not json at all");
      },
    };
    const real = Object.getOwnPropertyDescriptor(process, "stdin")!;
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    try {
      expect(await hook("session-start", "claude")).toBe(0);
    } finally {
      Object.defineProperty(process, "stdin", real);
    }
  });
});

describe("a machine that was reset", () => {
  it("tells the two states apart: nothing wired, and a key that is gone", async () => {
    const { runMoment } = await import("../src/loop/hook.js");

    // Nothing wired here at all.
    await mkdir(project, { recursive: true });
    const stdin = (payload: object) => ({
      isTTY: false,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(payload));
      },
    });
    const real = Object.getOwnPropertyDescriptor(process, "stdin")!;

    Object.defineProperty(process, "stdin", {
      value: stdin({ cwd: project }),
      configurable: true,
    });
    let result = await runMoment("session-start", "claude");
    expect(result.context).toContain("not wired");

    // Wired, but this machine no longer holds the key — after a reset, a
    // keyring moved between machines, or a revoked key. Same shape, different
    // problem, different fix.
    const { saveProject } = await import("../src/project.js");
    await saveProject({ instance: "http://localhost:3100", space: "avalon" }, project);
    Object.defineProperty(process, "stdin", {
      value: stdin({ cwd: project }),
      configurable: true,
    });
    result = await runMoment("session-start", "claude");
    Object.defineProperty(process, "stdin", real);

    expect(result.context).toContain("no key for avalon");
    expect(result.context).toContain("memcell connect");
  });
});

describe("the browser target a device grant hands back", () => {
  it("is refused unless it belongs to the instance the person named", async () => {
    // The URL arrives from the instance and, on Windows, reaches cmd. A
    // hostile or compromised host could otherwise choose what a person's
    // shell opens — or runs.
    const { openBrowserTarget } = await import("../src/grant.js");
    const ok = "https://memcell.ai/device?code=ABC";
    expect(openBrowserTarget(ok, "https://memcell.ai")).toBe(ok);

    // Somewhere else entirely.
    expect(openBrowserTarget("https://evil.test/steal", "https://memcell.ai")).toBeNull();
    // Not a web page at all.
    expect(openBrowserTarget("file:///etc/passwd", "https://memcell.ai")).toBeNull();
    expect(
      openBrowserTarget('https://memcell.ai/x" & calc.exe & "', "https://memcell.ai"),
    ).not.toContain('"');
    // Not a URL.
    expect(openBrowserTarget("not a url", "https://memcell.ai")).toBeNull();
  });
});

describe("the hook boundary", () => {
  it("never lets anything cross — a hook that dies takes the user's turn with it", async () => {
    // This process is the user's coding agent calling out mid-turn. A throw
    // exits non-zero with a Node stack trace in their terminal, and some
    // harnesses read that as the turn failing: memory breaking the work it
    // exists to help.
    const { hook } = await import("../src/commands/hook.js");
    const loop = await import("../src/loop/hook.js");
    const broke = vi.spyOn(loop, "runMoment").mockRejectedValue(new Error("the instance exploded"));
    try {
      await expect(hook("turn-end", "claude")).resolves.toBe(0);
    } finally {
      broke.mockRestore();
    }
  });

  it("survives a home directory it cannot write", async () => {
    // A full disk, a read-only home, a sandbox. The session note is how the
    // next firing knows where it got to; losing one costs a re-read, which
    // is harmless because the turn carries its own name.
    const { keepNote, dropNote } = await import("../src/loop/session.js");
    const { writeFile } = await import("node:fs/promises");
    const stopped = vi.spyOn({ writeFile }, "writeFile");
    await expect(keepNote("s1", { read: 0 } as never)).resolves.toBeUndefined();
    await expect(dropNote("s1")).resolves.toBeUndefined();
    stopped.mockRestore();
  });
});
