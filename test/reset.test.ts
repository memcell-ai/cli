import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = join(process.cwd(), ".memcell", "test-reset-home");

// The directory reset is told to act on. It must be one this test made,
// under the system temp directory ON PURPOSE: the project search climbs
// parents, so a target inside any checkout can resolve to whatever wired
// directory sits above it — and mocking the home directory hides that,
// because the wiring reset touches is project-side, not home-side.
const where = mkdtempSync(join(tmpdir(), "memcell-reset-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const said: string[] = [];
vi.spyOn(console, "log").mockImplementation((line: unknown) => {
  said.push(String(line));
});

const { reset } = await import("../src/commands/reset.js");
const { MACHINE_STATE, machineDir, machineFile } = await import("../src/machine.js");

// `memcell reset` — the command that exists so nobody is told to delete files
// out of their own home directory on trust.
//
// What it is judged on here is not that it removes things. It is that what it
// removes is a list the product holds, that it says the two things it cannot
// undo, that it will not touch what it cannot describe — and that it acts on
// the directory it is GIVEN, never one it went looking for.

async function laid(extra: Record<string, string> = {}) {
  await rm(home, { recursive: true, force: true });
  await mkdir(machineFile("sessions"), { recursive: true });
  await writeFile(machineFile("credentials.json"), JSON.stringify({ "http://x": { token: "t" } }));
  await writeFile(
    machineFile("agent-keys.json"),
    JSON.stringify({
      keys: {
        "http://x|k1": { instance: "http://x", keyId: "k1", key: "mc_k1", project: "/tmp/one" },
      },
    }),
  );
  await writeFile(machineFile("config.json"), JSON.stringify({ url: "http://x" }));
  await writeFile(machineFile("hook.log"), "a line\n");
  await writeFile(machineFile("sessions", "s1.json"), "{}");
  for (const [name, body] of Object.entries(extra)) await writeFile(machineFile(name), body);
}

const out = () => said.join("\n");

beforeEach(() => {
  said.length = 0;
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("memcell reset", () => {
  it("with no terminal to ask, shows the plan and requires --force", async () => {
    // The test env is not a TTY, so there is nobody to confirm to. Rather
    // than hang on a prompt, it shows what it would do and asks for the flag.
    await laid();
    expect(await reset(false, where)).toBe(1);

    expect(out()).toContain("the sessions that sign this machine in");
    expect(out()).toContain("the agent keys held here");
    expect(out()).toContain("to do this non-interactively");
    expect(out()).toContain("memcell reset --force");

    // And nothing was removed.
    expect((await readdir(machineDir())).sort()).toEqual(
      ["agent-keys.json", "config.json", "credentials.json", "hook.log", "sessions"].sort(),
    );
  });

  it("forgets all of it with --force, and the directory is empty after", async () => {
    await laid();
    expect(await reset(true, where)).toBe(0);
    expect(await readdir(machineDir())).toEqual([]);
  });

  it("says the two things it cannot undo, because neither is obvious", async () => {
    await laid();
    await reset(true, where);

    // A forgotten key is not a revoked key. Somebody who reset to "clean up
    // after a leak" and read nothing here would believe the opposite.
    expect(out()).toContain("keys still live");
    expect(out()).toContain("memcell agents");

    // And the hooks stay in each project's own config, where they will fire,
    // find no key, and do nothing — silently, by design.
    expect(out()).toContain("hooks still installed elsewhere");
    expect(out()).toContain("run memcell reset in each");
    expect(out()).toContain("/tmp/one");
  });

  it("leaves alone what it cannot describe, and says it did", async () => {
    // The whole basis for trusting it. A file this command does not know
    // about is somebody else's — another tool's, a person's — and deleting
    // the contents of a directory is not the same act as deleting the things
    // you can name.
    await laid({ "something-else.json": "{}" });
    await reset(true, where);

    expect(out()).toContain("left alone");
    expect(out()).toContain("something-else.json");
    expect(await readdir(machineDir())).toEqual(["something-else.json"]);
  });

  it("is honest and idempotent when there is nothing to forget", async () => {
    await rm(home, { recursive: true, force: true });
    expect(await reset(true, where)).toBe(0);
    expect(out()).toContain("nothing to reset");
  });

  it("acts on the directory it is given, and cannot reach a project elsewhere", async () => {
    // Reset must act only on the directory it is given. Called with no
    // directory it reads process.cwd(), and the parent-climbing project
    // search can then resolve to a wired directory outside the test's
    // sandbox — silently, since home-directory mocking does not cover
    // project-side wiring.
    const elsewhere = mkdtempSync(join(tmpdir(), "memcell-elsewhere-"));
    await mkdir(join(elsewhere, ".claude"), { recursive: true });
    await writeFile(join(elsewhere, ".memcell"), '[instance]\nurl = "https://memcell.ai"\n');
    await writeFile(join(elsewhere, ".claude", "settings.local.json"), '{"hooks":{"Stop":[]}}');

    await laid();
    await reset(true, where);

    // Still connected, still wired — reset was pointed somewhere else.
    expect(await readFile(join(elsewhere, ".memcell"), "utf8")).toContain("memcell.ai");
    expect(await readFile(join(elsewhere, ".claude", "settings.local.json"), "utf8")).toContain(
      "Stop",
    );
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("names every file memcell writes here", async () => {
    // The gate that keeps the command true. A module that starts writing a
    // sixth file into this directory and does not add it here leaves `reset`
    // quietly leaving it behind — and the person who ran reset believing it
    // cleared the machine has a credential they think is gone.
    const named = new Set(MACHINE_STATE.map((e) => e.path));
    const cli = join(process.cwd(), "src");

    const walk = async (dir: string, out: string[] = []): Promise<string[]> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, out);
        else if (entry.name.endsWith(".ts")) out.push(path);
      }
      return out;
    };

    const written = new Set<string>();
    for (const file of await walk(cli)) {
      const body = await readFile(file, "utf8");
      // `machineFile("x")` and `machineFile("x", …)` are the only ways into
      // this directory, which is what makes the set knowable at all.
      for (const found of body.matchAll(/machineFile\(\s*"([^"]+)"/g)) written.add(found[1]!);
    }

    expect(
      [...written].filter((p) => !named.has(p)),
      "add it to MACHINE_STATE",
    ).toEqual([]);
    expect(written.size).toBeGreaterThan(0);
  });
});
