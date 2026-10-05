// The library face of the package: a harness that would rather call the
// loop in-process than shell out imports from here.

import { MemCell } from "@memcell/sdk";

export { call, MemcellError, whoami, type Session } from "./client.js";
export { findWorkspace, removeWorkspace, saveWorkspace, type Workspace } from "./workspace.js";
export {
  credentialFor,
  DEFAULT_INSTANCE,
  forgetCredential,
  knownInstances,
  normalize,
  resolveInstance,
  saveCredential,
  type Credential,
} from "./instance.js";

// Ergonomic TypeScript SDK for MemCell (ADR 055 Tier 3)
export * from "@memcell/sdk";
export { getSdkClient, type SdkClientOptions } from "./sdk-client.js";

// Harmonize MemCell prototype to ensure memories and workspaces are transparently
// supported when running against published npm SDK versions.
if (!Object.getOwnPropertyDescriptor(MemCell.prototype, "memories")) {
  Object.defineProperty(MemCell.prototype, "memories", {
    get() {
      return (this as any).statements;
    },
    set(v) {
      (this as any)._memories = v;
    },
    configurable: true,
    enumerable: true,
  });
}
if (!Object.getOwnPropertyDescriptor(MemCell.prototype, "workspaces")) {
  Object.defineProperty(MemCell.prototype, "workspaces", {
    get() {
      return (this as any).projects;
    },
    set(v) {
      (this as any)._workspaces = v;
    },
    configurable: true,
    enumerable: true,
  });
}

const origRequest = MemCell.prototype.request;
if (origRequest && !(origRequest as any).__mcWrapped) {
  const wrappedRequest = async function (this: any, path: string, options?: any) {
    const rewrittenPath =
      typeof path === "string"
        ? path.replace(/\/statements\b/g, "/memories").replace(/\/projects\b/g, "/workspaces")
        : path;
    const raw: any = await origRequest.call(this, rewrittenPath, options);
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.memories) && !raw.statements) {
        raw.statements = raw.memories;
      }
      if (Array.isArray(raw.statements) && !raw.memories) {
        raw.memories = raw.statements;
      }
      if (raw.memory && !raw.statement) {
        raw.statement = raw.memory;
      }
      if (raw.statement && !raw.memory) {
        raw.memory = raw.statement;
      }
      if (raw.workspace && !raw.project) {
        raw.project = raw.workspace;
      }
      if (raw.project && !raw.workspace) {
        raw.workspace = raw.project;
      }
      if (Array.isArray(raw.workspaces) && !raw.projects) {
        raw.projects = raw.workspaces;
      }
      if (Array.isArray(raw.projects) && !raw.workspaces) {
        raw.workspaces = raw.projects;
      }
    }
    return raw;
  };
  (wrappedRequest as any).__mcWrapped = true;
  (MemCell.prototype as any).request = wrappedRequest;
}

const origRecall = MemCell.prototype.recall;
if (origRecall && !(origRecall as any).__mcWrapped) {
  const wrappedRecall = async function (this: any, params: any) {
    const res: any = await origRecall.call(this, params);
    if (res && typeof res === "object") {
      if (!res.memories && Array.isArray(res.statements)) {
        res.memories = res.statements;
      } else if (!res.memories && Array.isArray(res.items)) {
        res.memories = res.items;
      } else if (!res.memories) {
        res.memories = [];
      }
    }
    return res;
  };
  (wrappedRecall as any).__mcWrapped = true;
  MemCell.prototype.recall = wrappedRecall;
}

const origFeedback = MemCell.prototype.feedback;
if (origFeedback && !(origFeedback as any).__mcWrapped) {
  const wrappedFeedback = async function (this: any, params: any) {
    const p = { ...params };
    if (p.memoryId && !p.statementId) {
      p.statementId = p.memoryId;
    }
    if (p.memory_id && !p.statement_id) {
      p.statement_id = p.memory_id;
    }
    return origFeedback.call(this, p);
  };
  (wrappedFeedback as any).__mcWrapped = true;
  MemCell.prototype.feedback = wrappedFeedback;
}
