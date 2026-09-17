import { describe, expect, it, vi } from "vitest";
import { MemCell, ScopedMemCell, AuthManager } from "../src/index.js";

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
  });
});
