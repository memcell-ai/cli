import { MemCell } from "@memcell/sdk";
import { credentialFor } from "./instance.js";
import { detectActiveRuntimeModel } from "./model-detect.js";

export interface SdkClientOptions {
  bearer?: string;
  anonymous?: boolean;
  fetch?: typeof fetch;
}

/**
 * Returns a configured MemCell SDK instance for the given target instance.
 * Automatically resolves the bearer token from the connected workspace or user credentials.
 */
export async function getSdkClient(
  instance: string,
  options: SdkClientOptions = {},
): Promise<MemCell> {
  let apiKey: string | undefined = options.bearer;
  let accessToken: string | undefined;

  if (!apiKey && !options.anonymous) {
    const cred = await credentialFor(instance);
    if (cred?.token) {
      accessToken = cred.token;
    }
  }

  if (!apiKey && !accessToken && options.anonymous) {
    apiKey = "anonymous";
  }

  const baseFetch = options.fetch ?? fetch;
  const runtimeModel = detectActiveRuntimeModel();
  let activeRecallMetadata: Record<string, unknown> | undefined;

  const customFetch: typeof fetch = async (input, init) => {
    const headersObj: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers || typeof (init.headers as any).forEach === "function") {
        (init.headers as any).forEach((value: string, key: string) => {
          headersObj[key.toLowerCase()] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headersObj[key.toLowerCase()] = value;
        }
      } else {
        for (const [key, value] of Object.entries(init.headers)) {
          headersObj[key.toLowerCase()] = value as string;
        }
      }
    }
    if (runtimeModel && !headersObj["x-memcell-model"]) {
      headersObj["x-memcell-model"] = runtimeModel;
    }

    let body = init?.body;
    if (typeof body === "string" && body.startsWith("{")) {
      try {
        const parsed = JSON.parse(body);
        let changed = false;
        if (parsed.title && !parsed.text) {
          parsed.text = parsed.title;
          changed = true;
        }
        if (parsed.memoryId && !parsed.memory_id) {
          parsed.memory_id = parsed.memoryId;
          changed = true;
        }
        if (parsed.project && !parsed.workspace) {
          parsed.workspace = parsed.project;
          changed = true;
        }
        if (parsed.workspace && !parsed.project) {
          parsed.project = parsed.workspace;
          changed = true;
        }
        if (parsed.reason && !parsed.note) {
          parsed.note = parsed.reason;
          changed = true;
        }
        if (activeRecallMetadata && !parsed.metadata) {
          parsed.metadata = activeRecallMetadata;
          changed = true;
        }
        if (changed) {
          body = JSON.stringify(parsed);
        }
      } catch {
        // ignore
      }
    }

    const res = await baseFetch(input, { ...init, headers: headersObj, body });

    const hasHeadersGet = Boolean(res?.headers && typeof (res.headers as any).get === "function");
    const headersMap = hasHeadersGet
      ? res.headers
      : {
          get: (name: string) => {
            if (!res?.headers) return null;
            if (typeof (res.headers as any).get === "function")
              return (res.headers as any).get(name);
            return (res.headers as any)[name] || (res.headers as any)[name.toLowerCase()] || null;
          },
          has: (name: string) => {
            if (!res?.headers) return false;
            return !!((res.headers as any)[name] || (res.headers as any)[name.toLowerCase()]);
          },
        };

    const originalJson = typeof res?.json === "function" ? res.json.bind(res) : null;
    const jsonFn = async () => {
      let raw: any;
      if (originalJson) {
        raw = await originalJson();
      } else if (typeof (res as any)?.text === "function") {
        const text = await (res as any).text();
        raw = text ? JSON.parse(text) : {};
      } else {
        raw = {};
      }

      if (raw && typeof raw === "object") {
        if (!raw.organization && (raw.slug || raw.name) && !raw.organizations && !raw.members) {
          raw.organization = { ...raw };
        }
        if (Array.isArray(raw.items) && !raw.memories) {
          raw.memories = raw.items;
        }
        if (Array.isArray(raw.results)) {
          for (const item of raw.results) {
            if (item && typeof item === "object") {
              if (item.memoryId && !item.id) item.id = item.memoryId;
              if (item.id && !item.memoryId) item.memoryId = item.id;
              if (item.text && !item.title) item.title = item.text;
              if (item.title && !item.text) item.text = item.title;
              if (item.pinned && item.isPinned === undefined) item.isPinned = item.pinned;
              if (item.isPinned && item.pinned === undefined) item.pinned = item.isPinned;
            }
          }
        }
        if (Array.isArray(raw.memories)) {
          if (!raw.items) raw.items = raw.memories;
          if (!raw.results) raw.results = raw.memories;
          for (const item of raw.memories) {
            if (item && typeof item === "object") {
              if (item.memoryId && !item.id) item.id = item.memoryId;
              if (item.id && !item.memoryId) item.memoryId = item.id;
              if (item.text && !item.title) item.title = item.text;
              if (item.title && !item.text) item.text = item.title;
              if (item.pinned && item.isPinned === undefined) item.isPinned = item.pinned;
              if (item.isPinned && item.pinned === undefined) item.pinned = item.isPinned;
            }
          }
        }
      }
      return raw;
    };

    return new Proxy(res, {
      get(target, prop) {
        if (prop === "headers") return headersMap;
        if (prop === "json") return jsonFn;
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  };

  const client = new MemCell({
    baseUrl: instance,
    ...(apiKey ? { apiKey } : {}),
    ...(accessToken ? { accessToken } : {}),
    fetch: customFetch,
  });

  if (typeof (client as any).workspace !== "function") {
    (client as any).workspace = (ns: string, opts?: any) => client.scope(ns, opts);
  }

  if (!(client as any).memories) {
    (client as any).memories = {
      list: async (namespace: string, params?: any) => {
        const parts = namespace.split("/");
        const q = new URLSearchParams();
        if (params?.page) q.set("page", String(params.page));
        if (params?.limit) q.set("limit", String(params.limit));
        if (params?.type) q.set("type", params.type);
        if (params?.status) q.set("status", params.status);
        if (params?.scope) q.set("scope", params.scope);
        const qs = q.toString() ? `?${q.toString()}` : "";
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories${qs}`,
        );
      },
      get: async (namespace: string, memoryId: string) => {
        const parts = namespace.split("/");
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}`,
        );
        return (json as any)?.memory || json;
      },
      create: async (namespace: string, input: any) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        );
      },
      update: async (namespace: string, memoryId: string, input: any) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(input),
          },
        );
      },
      delete: async (namespace: string, memoryId: string, options?: any) => {
        const parts = namespace.split("/");
        const qs = options?.allVersions ? "?allVersions=true" : "";
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}${qs}`,
          {
            method: "DELETE",
          },
        );
      },
      star: async (namespace: string, memoryId: string) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/star`,
          {
            method: "PUT",
          },
        );
      },
      history: async (namespace: string, memoryId: string) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/history`,
        );
      },
      adopt: async (namespace: string, memoryId: string, input: any) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/adopt`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        );
      },
      relations: {
        list: async (namespace: string, memoryId: string) => {
          const parts = namespace.split("/");
          return (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(memoryId)}/relations`,
          );
        },
        create: async (namespace: string, sourceId: string, input: any) => {
          const parts = namespace.split("/");
          const json = await (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(sourceId)}/relations`,
            {
              method: "POST",
              body: JSON.stringify(input),
            },
          );
          return json.relation;
        },
        delete: async (namespace: string, sourceId: string, relationId: string) => {
          const parts = namespace.split("/");
          return (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/memories/${encodeURIComponent(sourceId)}/relations/${encodeURIComponent(relationId)}`,
            {
              method: "DELETE",
            },
          );
        },
      },
    };
  }

  if (!(client as any).workspaces) {
    (client as any).workspaces = {
      list: async () => (client as any).request("/api/v1/workspaces"),
      listForOwner: async (owner: string) =>
        (client as any).request(`/api/v1/organizations/${encodeURIComponent(owner)}/workspaces`),
      get: async (id: string) => {
        if (id.includes("/")) {
          const parts = id.split("/");
          const json = await (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}`,
          );
          return json.workspace || json.project || json;
        }
        return (client as any).request(`/api/v1/workspaces/${encodeURIComponent(id)}`);
      },
      create: async (input: any) =>
        (client as any).request("/api/v1/workspaces", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      update: async (id: string, input: any) => {
        if (id.includes("/")) {
          const parts = id.split("/");
          return (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}`,
            {
              method: "PATCH",
              body: JSON.stringify(input),
            },
          );
        }
        return (client as any).request(`/api/v1/workspaces/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        });
      },
      delete: async (id: string) => {
        if (id.includes("/")) {
          const parts = id.split("/");
          return (client as any).request(
            `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}`,
            {
              method: "DELETE",
            },
          );
        }
        return (client as any).request(`/api/v1/workspaces/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      },
    };
  } else {
    const origWsGet = (client as any).workspaces.get.bind((client as any).workspaces);
    (client as any).workspaces.get = async (id: string) => {
      if (id.includes("/")) {
        const parts = id.split("/");
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}`,
        );
        return json.workspace || json.project || json;
      }
      return origWsGet(id);
    };
  }

  if (!(client as any).workspaces.activity) {
    (client as any).workspaces.activity = async (namespace: string, options?: any) => {
      const parts = namespace.split("/");
      const q = new URLSearchParams();
      if (options?.limit) q.set("limit", String(options.limit));
      if (options?.offset) q.set("offset", String(options.offset));
      if (options?.outcome) q.set("outcome", options.outcome);
      if (options?.subject) q.set("subject", options.subject);
      if (options?.memoryId) q.set("memory_id", options.memoryId);
      const qs = q.toString() ? `?${q.toString()}` : "";
      const json = await (client as any).request(
        `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/activity${qs}`,
      );
      return json.items || json.activity || [];
    };
  }

  if (!(client as any).webhooks) {
    (client as any).webhooks = {
      list: async (namespace: string, params?: any) => {
        const parts = namespace.split("/");
        const q = new URLSearchParams();
        if (params?.limit) q.set("limit", String(params.limit));
        if (params?.offset) q.set("offset", String(params.offset));
        const qs = q.toString() ? `?${q.toString()}` : "";
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks${qs}`,
        );
        return json.webhooks || json.items || [];
      },
      get: async (namespace: string, webhookId: string) => {
        const parts = namespace.split("/");
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks/${encodeURIComponent(webhookId)}`,
        );
        return json.webhook || json;
      },
      create: async (namespace: string, input: any) => {
        const parts = namespace.split("/");
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks`,
          { method: "POST", body: JSON.stringify(input) },
        );
        return json.webhook || json;
      },
      update: async (namespace: string, webhookId: string, input: any) => {
        const parts = namespace.split("/");
        const json = await (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks/${encodeURIComponent(webhookId)}`,
          { method: "PATCH", body: JSON.stringify(input) },
        );
        return json.webhook || json;
      },
      delete: async (namespace: string, webhookId: string) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks/${encodeURIComponent(webhookId)}`,
          { method: "DELETE" },
        );
      },
      ping: async (namespace: string, webhookId: string) => {
        const parts = namespace.split("/");
        return (client as any).request(
          `/api/v1/${encodeURIComponent(parts[0] || "")}/${encodeURIComponent(parts[1] || "")}/webhooks/${encodeURIComponent(webhookId)}/ping`,
          { method: "POST" },
        );
      },
    };
  }

  if (!(client as any).operator) {
    (client as any).operator = {
      stats: async () => (client as any).request("/api/v1/operator/stats"),
      analytics: async (params?: any) => {
        const q = new URLSearchParams();
        if (params?.timeframe) q.set("timeframe", params.timeframe);
        if (params?.days) q.set("days", String(params.days));
        const qs = q.toString() ? `?${q.toString()}` : "";
        return (client as any).request(`/api/v1/operator/analytics${qs}`);
      },
      config: async () => (client as any).request("/api/v1/operator/config"),
      limits: async (limitType?: string) => {
        const qs = limitType ? `?type=${encodeURIComponent(limitType)}` : "";
        return (client as any).request(`/api/v1/operator/limits${qs}`);
      },
      users: async (params?: any) => {
        const q = new URLSearchParams();
        if (params?.page) q.set("page", String(params.page));
        if (params?.perPage) q.set("per_page", String(params.perPage));
        if (params?.role) q.set("role", params.role);
        if (params?.search) q.set("search", params.search);
        const qs = q.toString() ? `?${q.toString()}` : "";
        return (client as any).request(`/api/v1/operator/users${qs}`);
      },
      workspaces: async (params?: any) => {
        const q = new URLSearchParams();
        if (params?.page) q.set("page", String(params.page));
        if (params?.perPage) q.set("per_page", String(params.perPage));
        if (params?.search) q.set("search", params.search);
        const qs = q.toString() ? `?${q.toString()}` : "";
        return (client as any).request(`/api/v1/operator/workspaces${qs}`);
      },
    };
  }

  if (!(client as any).invitations) {
    (client as any).invitations = {
      get: async (token: string) =>
        (client as any).request(`/api/v1/invitations/workspace/${encodeURIComponent(token)}`),
      accept: async (token: string) =>
        (client as any).request(
          `/api/v1/invitations/workspace/${encodeURIComponent(token)}/accept`,
          { method: "POST" },
        ),
      decline: async (token: string) =>
        (client as any).request(
          `/api/v1/invitations/workspace/${encodeURIComponent(token)}/decline`,
          { method: "POST" },
        ),
    };
  }

  const origForOrg =
    (client as any).forOrg?.bind(client) || (client as any).forOrganization?.bind(client);
  (client as any).forOrg = (orgSlug: string) => {
    let orgHandle: any;
    try {
      orgHandle = origForOrg ? origForOrg(orgSlug) : {};
    } catch {
      orgHandle = {};
    }
    if (!orgHandle.teams) {
      orgHandle.teams = {
        list: async () => {
          const res = await (client as any).request(
            `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams`,
          );
          return res.teams || [];
        },
        get: async (teamId: string) => {
          return (client as any).request(
            `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}`,
          );
        },
        create: async (name: string, opts?: any) => {
          return (client as any).request(
            `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams`,
            {
              method: "POST",
              body: JSON.stringify({ name, ...opts }),
            },
          );
        },
        update: async (teamId: string, name: string, opts?: any) => {
          return (client as any).request(
            `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ name, ...opts }),
            },
          );
        },
        delete: async (teamId: string) => {
          return (client as any).request(
            `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}`,
            {
              method: "DELETE",
            },
          );
        },
        members: {
          list: async (teamId: string) => {
            const res = await (client as any).request(
              `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}/members`,
            );
            return res.members || [];
          },
          add: async (teamId: string, userId: string, role?: string) => {
            return (client as any).request(
              `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}/members`,
              {
                method: "POST",
                body: JSON.stringify({ userId, role: role || "member" }),
              },
            );
          },
          remove: async (teamId: string, userId: string) => {
            return (client as any).request(
              `/api/v1/organizations/${encodeURIComponent(orgSlug)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
              {
                method: "DELETE",
              },
            );
          },
        },
      };
    }
    return orgHandle;
  };

  const origRecall = client.recall.bind(client);
  client.recall = async (params: any) => {
    activeRecallMetadata = params?.metadata;
    try {
      const res = await origRecall(params);
      if (res && typeof res === "object") {
        const rawList = (res as any).memories || (res as any).results || (res as any).items || [];
        const mapped = rawList.map((item: any) => {
          const id = item.id || item.memoryId;
          const text = item.text || item.title || "";
          const pinned = Boolean(item.pinned ?? item.isPinned);
          return {
            ...item,
            id,
            memoryId: id,
            text,
            pinned,
            isPinned: pinned,
          };
        });
        (res as any).memories = mapped;
        (res as any).results = mapped;
      }
      return res;
    } finally {
      activeRecallMetadata = undefined;
    }
  };

  client.feedback = async (params: any) => {
    const p = { ...params };
    const memoryId = p.memoryId ?? p.memory_id;
    const path =
      typeof (client as any).resolveEndpoint === "function"
        ? (client as any).resolveEndpoint(p.namespace, "feedback")
        : "/api/v1/feedback";
    const payload: Record<string, unknown> = {
      memory_id: memoryId,
      outcome: p.outcome,
    };
    if (p.recallId !== undefined) payload.recall_id = p.recallId;
    if (p.note !== undefined) payload.note = p.note;
    if (p.reason !== undefined && p.note === undefined) payload.reason = p.reason;
    if (p.externalRef !== undefined) payload.external_ref = p.externalRef;
    if (p.payload !== undefined) payload.payload = p.payload;
    if (p.workspace) payload.workspace = p.workspace;
    return (client as any).request(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  };
  (client as any).report = client.feedback;

  return client;
}
