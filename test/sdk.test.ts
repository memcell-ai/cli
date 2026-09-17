import { describe, expect, it, vi } from "vitest";
import { MemCell, ScopedMemCell, AuthManager, MemCellError, RateLimitError } from "../src/index.js";

describe("MemCell SDK (cli package export)", () => {
  describe("AuthManager", () => {
    it("returns Bearer with API key directly", async () => {
      const auth = new AuthManager({ apiKey: "mc_live_123" }, "https://api.memcell.io");
      const header = await auth.getAuthorizationHeader();
      expect(header).toBe("Bearer mc_live_123");
    });

    it("returns Bearer with accessToken directly", async () => {
      const auth = new AuthManager({ accessToken: "jwt_token_abc" }, "https://api.memcell.io");
      const header = await auth.getAuthorizationHeader();
      expect(header).toBe("Bearer jwt_token_abc");
    });

    it("exchanges client_credentials and caches M2M token", async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/oauth2/token")) {
          callCount++;
          const body = String(init?.body);
          expect(body).toContain("grant_type=client_credentials");
          expect(body).toContain("client_id=client_xyz");
          expect(body).toContain("client_secret=secret_xyz");
          expect(body).toContain("scope=memory%3Aread");
          return new Response(
            JSON.stringify({
              access_token: "m2m_token_001",
              token_type: "Bearer",
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      });

      const auth = new AuthManager(
        {
          clientId: "client_xyz",
          clientSecret: "secret_xyz",
          scope: "memory:read",
        },
        "https://api.memcell.io",
        mockFetch as any,
      );

      const header1 = await auth.getAuthorizationHeader();
      expect(header1).toBe("Bearer m2m_token_001");
      expect(callCount).toBe(1);

      const header2 = await auth.getAuthorizationHeader();
      expect(header2).toBe("Bearer m2m_token_001");
      expect(callCount).toBe(1);

      auth.clearCache();
      const header3 = await auth.getAuthorizationHeader();
      expect(header3).toBe("Bearer m2m_token_001");
      expect(callCount).toBe(2);
    });

    it("refreshes M2M token proactively when within 60s pre-expiry window", async () => {
      let tokenIndex = 1;
      const mockFetch = vi.fn(async () => {
        const token = `m2m_token_00${tokenIndex++}`;
        return new Response(
          JSON.stringify({
            access_token: token,
            token_type: "Bearer",
            expires_in: 50,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const auth = new AuthManager(
        { clientId: "cid", clientSecret: "csec" },
        "https://api.memcell.io",
        mockFetch as any,
      );

      const header1 = await auth.getAuthorizationHeader();
      expect(header1).toBe("Bearer m2m_token_001");

      const header2 = await auth.getAuthorizationHeader();
      expect(header2).toBe("Bearer m2m_token_002");
    });
  });

  describe("MemCell Client", () => {
    it("handles baseUrl and endpoint routing for scoped and unscoped namespaces", async () => {
      const requests: Array<{ url: string; body: any }> = [];

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });

        return new Response(
          JSON.stringify({
            recallId: "rec_123",
            promptContext: "<memcell>Context</memcell>",
            statements: [
              {
                id: "st_1",
                title: "Never skip verification",
                kind: "invariant",
                confidence: 0.95,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const memcell = new MemCell({
        auth: { apiKey: "key_1" },
        baseUrl: "https://custom.memcell.io///",
        fetch: mockFetch as any,
      });

      expect(memcell.baseUrl).toBe("https://custom.memcell.io");

      const res1 = await memcell.recall({
        namespace: "org/repo",
        query: "deploy procedure",
        kind: ["invariant", "reflex"],
        minConfidence: 0.8,
      });

      expect(res1.recallId).toBe("rec_123");
      expect(res1.statements).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://custom.memcell.io/api/v1/org/repo/recall");
      expect(requests[0]?.body.intent).toBe("deploy procedure");
    });

    it("ScopedMemCell & wrapExecution lifecycle", async () => {
      const calls: string[] = [];
      let reportedPayload: any;

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/recall")) {
          calls.push("recall");
          return new Response(
            JSON.stringify({
              recallId: "rec_run_42",
              promptContext: "<memcell>Guards loaded</memcell>",
              statements: [
                {
                  id: "st_1",
                  title: "Validate env before deploy",
                  kind: "invariant",
                  isInvariant: true,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.endsWith("/report")) {
          calls.push("report");
          reportedPayload = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              outcome: "worked",
              attributed: [{ statementId: "st_1", title: "Validate env", from: 0.8, to: 0.85 }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const memcell = new MemCell({ auth: { apiKey: "k" }, fetch: mockFetch as any });
      const devops = memcell.scope("acme/devops", { subject: "pipeline" });

      const execResult = await devops.wrapExecution(
        {
          action: "deploy_service",
          externalRef: "deploy_job_101",
        },
        async (ctx) => {
          calls.push("action");
          expect(ctx.recallId).toBe("rec_run_42");
          return { status: "ok" };
        },
      );

      expect(calls).toEqual(["recall", "action", "report"]);
      expect(execResult.result).toEqual({ status: "ok" });
      expect(reportedPayload.action_taken).toBe("deploy_service");
      expect(reportedPayload.outcome).toBe("worked");
    });

    it("handles async remember and waitForJob telemetry tracking", async () => {
      const progressUpdates: any[] = [];
      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/remember")) {
          const body = JSON.parse(String(init?.body));
          expect(body.async).toBe(true);
          return new Response(
            JSON.stringify({
              accepted: true,
              jobId: "job_async_99",
              status: "queued",
            }),
            { status: 202, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.endsWith("/jobs/job_async_99/stream")) {
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'data: {"step":"distilling","progress":25,"message":"Distilling facts..."}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"step":"reconciling","progress":75,"message":"Checking contradictions..."}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode('data: {"step":"completed","progress":100,"message":"Done."}\n\n'),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const memcell = new MemCell({ auth: { apiKey: "k" }, fetch: mockFetch as any });
      const devops = memcell.scope("acme/devops");

      const res = await devops.remember({
        raw: "Document text to distill into atomic invariants",
        async: true,
      } as any);

      expect(res.accepted).toBe(true);
      expect(res.jobId).toBe("job_async_99");

      const finalEvent = await devops.waitForJob(res.jobId!, {
        onProgress: (evt) => {
          progressUpdates.push(evt);
        },
      });

      expect(finalEvent.step).toBe("completed");
      expect(finalEvent.progress).toBe(100);
      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0].step).toBe("distilling");
      expect(progressUpdates[1].step).toBe("reconciling");
      expect(progressUpdates[2].step).toBe("completed");
    });

    it("manages organizations via memory.organizations and forOrganization", async () => {
      const requests: Array<{ url: string; method?: string; body: any }> = [];

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        requests.push({
          url: urlStr,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });

        if (urlStr.endsWith("/api/v1/organizations") && init?.method === "GET") {
          return new Response(
            JSON.stringify({
              ok: true,
              organizations: [
                { id: "o1", slug: "acme-corp", name: "Acme Corporation", role: "owner" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (urlStr.endsWith("/api/v1/organizations") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              organization: { id: "o2", slug: "robotics", name: "Robotics AI Lab", role: "owner" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }

        if (urlStr.endsWith("/api/v1/organizations/acme-corp")) {
          return new Response(
            JSON.stringify({
              ok: true,
              organization: {
                id: "o1",
                slug: "acme-corp",
                name: "Acme Corporation",
                role: "owner",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (urlStr.endsWith("/api/v1/acme-corp/backend/recall")) {
          return new Response(
            JSON.stringify({
              recallId: "rec_123",
              promptContext: "<xml></xml>",
              statements: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("Not found", { status: 404 });
      });

      const memcell = new MemCell({ auth: { apiKey: "k" }, fetch: mockFetch as any });

      // List
      const orgs = await memcell.organizations.list();
      expect(orgs).toHaveLength(1);
      expect(orgs[0]?.slug).toBe("acme-corp");

      // Create
      const created = await memcell.organizations.create({
        name: "Robotics AI Lab",
        slug: "robotics",
      });
      expect(created.slug).toBe("robotics");

      // Get
      const fetched = await memcell.organizations.get("acme-corp");
      expect(fetched.name).toBe("Acme Corporation");

      // forOrganization
      const acmeOrg = memcell.forOrganization("acme-corp");
      expect(acmeOrg.orgSlug).toBe("acme-corp");

      const scopedBackend = acmeOrg.scope("backend");
      expect(scopedBackend.namespace).toBe("acme-corp/backend");

      const recallRes = await acmeOrg.recall({
        namespace: "backend",
        query: "authentication flow",
      });
      expect(recallRes.recallId).toBe("rec_123");
      expect(requests.some((r) => r.url.endsWith("/api/v1/acme-corp/backend/recall"))).toBe(true);
    });

    it("intercepts RateLimit-Warning header and invokes onRateLimitWarning callback", async () => {
      const warningHandler = vi.fn();
      const mockFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ recallId: "rec_warning", statements: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "RateLimit-Warning":
              '299 - "Approaching rate limit capacity (85% consumed in active window)"',
          },
        });
      });

      const memcell = new MemCell({
        auth: { apiKey: "mc_live_test" },
        fetch: mockFetch as any,
        onRateLimitWarning: warningHandler,
      });

      const res = await memcell.recall({ query: "test warning" });
      expect(res.recallId).toBe("rec_warning");
      expect(warningHandler).toHaveBeenCalledWith(
        expect.stringContaining("Approaching rate limit capacity"),
        expect.anything(),
      );
    });

    it("automatically retries on HTTP 429 using Retry-After backoff", async () => {
      let attempts = 0;
      const mockFetch = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: "rate_limited", message: "Retry later" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          });
        }
        return new Response(JSON.stringify({ recallId: "rec_recovered", statements: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const memcell = new MemCell({
        auth: { apiKey: "mc_live_test" },
        fetch: mockFetch as any,
        maxRetries: 2,
      });

      const res = await memcell.recall({ query: "test retry" });
      expect(attempts).toBe(2);
      expect(res.recallId).toBe("rec_recovered");
    });

    it("throws typed RateLimitError with door and retryAfter when 429 retries are exhausted", async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: "rate_limited",
            message: "Rate limit exceeded on door 'remember'. Please retry in 15s.",
            door: "remember",
            limit: 60,
            windowSeconds: 60,
            retryAfter: 15,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          },
        );
      });

      const memcell = new MemCell({
        auth: { apiKey: "mc_live_test" },
        fetch: mockFetch as any,
        maxRetries: 1,
      });

      let caughtError: unknown = null;
      try {
        await memcell.remember({ title: "Exhaust retries" });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(RateLimitError);
      expect(caughtError).toBeInstanceOf(MemCellError);
      const rlError = caughtError as RateLimitError;
      expect(rlError.door).toBe("remember");
      expect(rlError.limit).toBe(60);
      expect(rlError.windowSeconds).toBe(60);
      expect(rlError.retryAfter).toBe(15);
      expect(rlError.status).toBe(429);
      expect(rlError.message).toContain("Rate limit exceeded on door 'remember'");
    });

    it("throws typed MemCellError on non-429 API errors", async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: "unauthorized",
            message: "Invalid API key provided",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const memcell = new MemCell({
        auth: { apiKey: "bad_key" },
        fetch: mockFetch as any,
      });

      let caughtError: unknown = null;
      try {
        await memcell.recall({ query: "failing request" });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MemCellError);
      expect(caughtError).not.toBeInstanceOf(RateLimitError);
      const memError = caughtError as MemCellError;
      expect(memError.status).toBe(401);
      expect(memError.code).toBe("unauthorized");
      expect(memError.message).toContain("Invalid API key provided");
    });
  });
});
