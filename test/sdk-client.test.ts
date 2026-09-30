import { describe, expect, it, vi } from "vitest";
import { getSdkClient } from "../src/sdk-client.js";

describe("getSdkClient", () => {
  it("wraps native Response objects without triggering private member #state error", async () => {
    // Uses real global Response instance to ensure native Node.js 24 private brand checks are exercised
    const nativeResponse = new Response(JSON.stringify({ ok: true, statements: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const mockFetch = vi.fn(async () => nativeResponse);

    const client = await getSdkClient("https://api.memcell.io", {
      bearer: "test_key",
      fetch: mockFetch as any,
    });

    // Exercising recall calls internal request() which checks response.status === 429 and !response.ok
    const result = await client.recall({ query: "test query" });
    expect(result).toBeDefined();
    expect(result.statements).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("normalizes headers into lowercase without sending duplicate header keys", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.fn(async (_url: any, init?: any) => {
      capturedHeaders = init?.headers ?? {};
      return new Response(JSON.stringify({ ok: true, statements: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = await getSdkClient("https://api.memcell.io", {
      bearer: "test_key_123",
      fetch: mockFetch as any,
    });

    await client.recall({ query: "test" });

    // Assert that authorization is present in lowercase and not duplicated in PascalCase
    expect(capturedHeaders["authorization"]).toBe("Bearer test_key_123");
    expect(capturedHeaders["Authorization"]).toBeUndefined();
    expect(capturedHeaders["content-type"]).toBe("application/json");
    expect(capturedHeaders["Content-Type"]).toBeUndefined();
  });

  it("allows calling methods on proxied response like clone() and text()", async () => {
    const nativeResponse = new Response("hello world", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

    const mockFetch = vi.fn(async () => nativeResponse);

    const client = await getSdkClient("https://api.memcell.io", {
      bearer: "test_key",
      fetch: mockFetch as any,
    });

    // Verify raw fetch returned by customFetch handler
    const rawRes = await (client as any).customFetch("https://api.memcell.io/test", {});
    expect(rawRes.ok).toBe(true);
    expect(rawRes.status).toBe(200);

    const cloned = rawRes.clone();
    expect(await cloned.text()).toBe("hello world");
    expect(await rawRes.text()).toBe("hello world");
  });
});
