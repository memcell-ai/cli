import { afterEach, describe, expect, it, vi } from "vitest";

import { call, MemcellError } from "../src/client.js";

// What the HTTP client does when the answer is not the happy one.
//
// A terminal talks to whatever address it is given, and that address is
// often wrong: a website instead of an instance, a dead port, a gateway
// returning HTML. None of those should reach a person as a stack trace or a
// raw "Unexpected token '<'" — the parser leaking through. Every one has to
// come back as a sentence.

const BASE = "http://instance.test";

afterEach(() => vi.unstubAllGlobals());

function answers(status: number, body: string, contentType = "application/json") {
  vi.stubGlobal("fetch", async () =>
    Object.assign(
      new Response(body, { status, headers: { "content-type": contentType } }),
      // Response.ok is derived from status, so the real Response is enough.
      {},
    ),
  );
}

describe("the client, when the answer is not JSON", () => {
  it("turns an HTML error page into a sentence, not a parse error", async () => {
    answers(404, "<!DOCTYPE html><html><body>Not found</body></html>", "text/html");
    const error = await call(BASE, "/api/v1/pair/claim", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(MemcellError);
    expect((error as MemcellError).message).not.toMatch(/Unexpected token|DOCTYPE|<html/);
    expect((error as MemcellError).message).toContain("not memcell");
  });

  it("turns a 200 that is a web page into a sentence", async () => {
    // The exact shape of the reported bug: a website answered where an
    // instance was expected, and JSON.parse blew up on the markup.
    answers(200, "<!DOCTYPE html><html><body>hello</body></html>", "text/html");
    const error = await call(BASE, "/api/v1/pair/claim", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(MemcellError);
    expect((error as MemcellError).message).not.toMatch(/Unexpected token|DOCTYPE/);
    expect((error as MemcellError).message).toContain("did not answer as a memcell instance");
  });

  it("keeps a JSON error's own message", async () => {
    answers(404, JSON.stringify({ message: "That pairing is not open." }));
    const error = await call(BASE, "/api/v1/pair/claim", { method: "POST" }).catch((e) => e);
    expect((error as MemcellError).message).toBe("That pairing is not open.");
  });

  it("says it could not reach an instance that is not there", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await call(BASE, "/api/v1/pair/claim", { method: "POST" }).catch((e) => e);
    expect((error as MemcellError).message).toContain("Could not reach");
  });

  it("returns the body when the answer really is JSON", async () => {
    answers(200, JSON.stringify({ pair: "ABC123" }));
    const body = await call<{ pair: string }>(BASE, "/api/v1/pair", { method: "POST" });
    expect(body.pair).toBe("ABC123");
  });
});
