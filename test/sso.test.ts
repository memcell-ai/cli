import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const home = await mkdtemp(join(tmpdir(), "memcell-sso-home-"));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const calls: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
let answer: (url: string) => unknown = () => ({});

vi.stubGlobal(
  "fetch",
  async (
    url: string,
    init: { method?: string; body?: string; headers: Record<string, string> },
  ) => {
    calls.push({
      url,
      method: init.method,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null),
      },
      text: async () => JSON.stringify(answer(url)),
      json: async () => answer(url),
    };
  },
);

// Mock deviceGrant so login doesn't attempt browser spawn or polling in test
vi.mock("../src/grant.js", () => ({
  deviceGrant: vi.fn(async () => true),
}));

const { login } = await import("../src/commands/login.js");
const { listOrgSSO, configureOrgSSO, verifyOrgSSO, enforceOrgSSO, deleteOrgSSO } =
  await import("../src/commands/orgs.js");
const { saveCredential } = await import("../src/instance.js");
const { deviceGrant } = await import("../src/grant.js");

const instance = "http://memcell.test";

beforeAll(async () => {
  await saveCredential({
    instance,
    token: "test_session_token",
    obtainedAt: new Date().toISOString(),
  });
});

beforeEach(() => {
  calls.length = 0;
  answer = () => ({});
  vi.clearAllMocks();
});

describe("enterprise SSO & IdP federation commands", () => {
  describe("login --sso", () => {
    it("looks up enterprise domain and continues to device grant on match", async () => {
      answer = (url) => {
        if (url.includes("/api/v1/auth/sso/lookup")) {
          return {
            domain: "acme.corp",
            ssoEnforced: true,
            organization: { id: "org_1", slug: "acme", name: "Acme Corp" },
            provider: { providerId: "okta", type: "saml" },
          };
        }
        if (url.includes("/api/auth/whoami")) {
          return { user: { id: "u_1", name: "Alice", isAnonymous: false } };
        }
        return {};
      };

      const code = await login(instance, { sso: "acme.corp", force: true });
      expect(code).toBe(0);
      expect(calls.some((c) => c.url.includes("/api/v1/auth/sso/lookup?domain=acme.corp"))).toBe(
        true,
      );
      expect(deviceGrant).toHaveBeenCalledWith(
        instance,
        expect.objectContaining({ retry: "memcell login --sso acme.corp" }),
      );
    });

    it("fails and exits with code 1 when domain lookup is not found", async () => {
      answer = (url) => {
        if (url.includes("/api/v1/auth/sso/lookup")) {
          throw new Error("No SSO provider found for domain unknown.corp");
        }
        return {};
      };

      const code = await login(instance, { sso: "unknown.corp" });
      expect(code).toBe(1);
      expect(deviceGrant).not.toHaveBeenCalled();
    });
  });

  describe("orgs sso list", () => {
    it("lists configured providers and enforcement status", async () => {
      answer = () => ({
        organization: {
          id: "org_1",
          slug: "acme",
          name: "Acme Corp",
          ssoEnforced: true,
        },
        providers: [
          {
            id: "prov_1",
            providerId: "okta",
            type: "saml",
            domain: "acme.corp",
            domainVerified: true,
            hasSamlMetadata: true,
            hasOidcConfig: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const code = await listOrgSSO(instance, "acme");
      expect(code).toBe(0);
      expect(calls.some((c) => c.url.includes("/api/v1/organizations/acme/sso"))).toBe(true);
    });
  });

  describe("orgs sso configure", () => {
    it("requires provider-id flag", async () => {
      const code = await configureOrgSSO(instance, "acme", {});
      expect(code).toBe(1);
    });

    it("configures a SAML provider with metadata URL and domain", async () => {
      answer = () => ({
        ok: true,
        provider: {
          id: "prov_1",
          providerId: "okta",
          type: "saml",
          domain: "acme.corp",
          domainVerified: false,
          hasSamlMetadata: true,
          hasOidcConfig: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const code = await configureOrgSSO(instance, "acme", {
        "provider-id": "okta",
        type: "saml",
        domain: "acme.corp",
        "metadata-url": "https://okta.acme.com/app/sso/saml/metadata",
      });
      expect(code).toBe(0);
      const postCall = calls.find(
        (c) => c.url.includes("/api/v1/organizations/acme/sso") && c.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(postCall?.body).toMatchObject({
        providerId: "okta",
        type: "saml",
        domain: "acme.corp",
        metadataUrl: "https://okta.acme.com/app/sso/saml/metadata",
      });
    });
  });

  describe("orgs sso verify", () => {
    it("reports success when domain verification passes", async () => {
      answer = () => ({
        ok: true,
        verified: true,
      });

      const code = await verifyOrgSSO(instance, "acme", { "provider-id": "okta" });
      expect(code).toBe(0);
      expect(
        calls.some((c) => c.url.includes("/api/v1/organizations/acme/sso/verify-domain")),
      ).toBe(true);
    });

    it("fetches DNS TXT token and displays record instruction when verification is pending", async () => {
      answer = (url) => {
        if (url.includes("/verify-domain")) {
          return { ok: true, verified: false };
        }
        if (url.includes("/token")) {
          return {
            token: "tok_12345",
            recordName: "_memcell-challenge.acme.corp",
            recordValue: "memcell-domain-verification=tok_12345",
            domain: "acme.corp",
          };
        }
        return {};
      };

      const code = await verifyOrgSSO(instance, "acme", { "provider-id": "okta" });
      expect(code).toBe(1);
      expect(calls.some((c) => c.url.includes("/sso/verify-domain"))).toBe(true);
      expect(calls.some((c) => c.url.includes("/sso/token"))).toBe(true);
    });
  });

  describe("orgs sso enforce", () => {
    it("enables SSO enforcement", async () => {
      answer = () => ({
        ok: true,
        ssoEnforced: true,
      });

      const code = await enforceOrgSSO(instance, "acme", {});
      expect(code).toBe(0);
      const patchCall = calls.find(
        (c) => c.url.includes("/api/v1/organizations/acme/sso/enforce") && c.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      expect(patchCall?.body).toEqual({ ssoEnforced: true });
    });

    it("disables SSO enforcement when --disable is passed", async () => {
      answer = () => ({
        ok: true,
        ssoEnforced: false,
      });

      const code = await enforceOrgSSO(instance, "acme", { disable: true });
      expect(code).toBe(0);
      const patchCall = calls.find(
        (c) => c.url.includes("/api/v1/organizations/acme/sso/enforce") && c.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      expect(patchCall?.body).toEqual({ ssoEnforced: false });
    });
  });

  describe("orgs sso delete", () => {
    it("deletes an SSO provider", async () => {
      answer = () => ({ ok: true });

      const code = await deleteOrgSSO(instance, "acme", { "provider-id": "okta" });
      expect(code).toBe(0);
      const deleteCall = calls.find(
        (c) =>
          c.url.includes("/api/v1/organizations/acme/sso?providerId=okta") && c.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });
  });
});
