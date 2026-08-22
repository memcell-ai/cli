import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The CLI stores a live session on disk, so what is pinned here is the part
// that would be dangerous to get wrong: an instance is part of the
// credential, never a separate setting. A token minted against a laptop's
// dev server must never be presentable to memcell.ai, and forgetting one
// instance must not disturb another.

const home = await mkdtemp(join(tmpdir(), "memcell-cli-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

// Somewhere with no connected project above it. `resolveInstance` asks the
// DIRECTORY first — that is the product's law — so a test left standing in
// a real checkout reads whatever workspace happens to enclose it, and
// passes or fails on the developer's machine rather than on the code.
const elsewhere = await mkdtemp(join(tmpdir(), "memcell-cli-cwd-"));
vi.spyOn(process, "cwd").mockReturnValue(elsewhere);

const {
  DEFAULT_INSTANCE,
  credentialFor,
  forgetCredential,
  knownInstances,
  normalize,
  resolveInstance,
  saveCredential,
} = await import("../src/instance.js");

const LOCAL = "http://localhost:3000";

beforeAll(() => {
  delete process.env.MEMCELL_INSTANCE;
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("instance resolution", () => {
  it("prefers the flag, then the environment, then the hosted one", async () => {
    expect(await resolveInstance("http://example.test/")).toBe("http://example.test");
    process.env.MEMCELL_INSTANCE = LOCAL;
    expect(await resolveInstance()).toBe(LOCAL);
    expect(await resolveInstance("http://flag.test")).toBe("http://flag.test");
    delete process.env.MEMCELL_INSTANCE;
    expect(await resolveInstance()).toBe(DEFAULT_INSTANCE);
  });

  it("strips trailing slashes so an instance is a usable prefix", () => {
    expect(normalize("http://localhost:3000///")).toBe(LOCAL);
  });
});

describe("the credential store", () => {
  it("keeps a token bound to the instance it came from", async () => {
    await saveCredential({
      instance: LOCAL,
      token: "local-token",
      obtainedAt: "2026-08-01T00:00Z",
    });
    await saveCredential({
      instance: DEFAULT_INSTANCE,
      token: "hosted-token",
      obtainedAt: "2026-08-01T00:00Z",
    });

    expect((await credentialFor(LOCAL))?.token).toBe("local-token");
    expect((await credentialFor(DEFAULT_INSTANCE))?.token).toBe("hosted-token");
    // the whole point: one instance's token is never offered to another
    expect(await credentialFor("http://elsewhere.test")).toBeNull();
  });

  it("remembers the last instance connected", async () => {
    await saveCredential({ instance: LOCAL, token: "t", obtainedAt: "2026-08-01T00:00Z" });
    expect(await resolveInstance()).toBe(LOCAL);
  });

  it("writes the store for this user only", async () => {
    const { mode } = await import("node:fs").then((fs) =>
      fs.promises.stat(join(home, ".memcell", "credentials.json")),
    );
    expect(mode & 0o077).toBe(0);
  });

  it("forgets one instance without disturbing the others", async () => {
    expect(await forgetCredential(LOCAL)).toBe(true);
    expect(await credentialFor(LOCAL)).toBeNull();
    expect((await credentialFor(DEFAULT_INSTANCE))?.token).toBe("hosted-token");
    expect(await knownInstances()).toEqual([DEFAULT_INSTANCE]);
    // forgetting what was never there is not an error
    expect(await forgetCredential(LOCAL)).toBe(false);
  });

  it("survives a corrupt store rather than taking the command down with it", async () => {
    const path = join(home, ".memcell", "credentials.json");
    await import("node:fs").then((fs) => fs.promises.writeFile(path, "{ not json"));
    expect(await credentialFor(LOCAL)).toBeNull();
    expect(await resolveInstance()).toBe(DEFAULT_INSTANCE);
    await readFile(path, "utf8");
  });
});
