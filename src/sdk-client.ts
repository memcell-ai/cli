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
 * Automatically resolves the bearer token from the connected project or user credentials.
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
        if (!raw.project && (raw.id || raw.slug) && raw.name !== undefined) {
          raw.project = { ...raw };
        }
        if (!raw.organization && (raw.slug || raw.name) && !raw.organizations && !raw.members) {
          raw.organization = { ...raw };
        }
        if (Array.isArray(raw.items) && !raw.memories) {
          raw.memories = raw.items;
        }
        if (Array.isArray(raw.memories) && !raw.items) {
          raw.items = raw.memories;
        }
        if (Array.isArray(raw.results)) {
          for (const item of raw.results) {
            if (item && typeof item === "object") {
              if (item.text && !item.title) item.title = item.text;
              if (item.pinned && item.isPinned === undefined) item.isPinned = item.pinned;
            }
          }
        }
        if (Array.isArray(raw.memories)) {
          for (const item of raw.memories) {
            if (item && typeof item === "object") {
              if (item.text && !item.title) item.title = item.text;
              if (item.pinned && item.isPinned === undefined) item.isPinned = item.pinned;
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

  const origRecall = client.recall.bind(client);
  client.recall = async (params: any) => {
    activeRecallMetadata = params?.metadata;
    try {
      return await origRecall(params);
    } finally {
      activeRecallMetadata = undefined;
    }
  };

  return client;
}
