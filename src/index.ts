// The library face of the package: a harness that would rather call the
// loop in-process than shell out imports from here.

export { call, MemcellError, whoami, type Session } from "./client.js";
export {
  ensureGitignore,
  findWorkspace,
  removeWorkspace,
  saveWorkspace,
  workspaceRoot,
  WORKSPACE_DIR,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_GITIGNORE,
  type Workspace,
  type FoundWorkspace,
} from "./workspace.js";
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

import { MemCell as BaseMemCell } from "@memcell/sdk";

// Ergonomic TypeScript SDK for MemCell
export * from "@memcell/sdk";
export class MemCell extends BaseMemCell {
  private _capturedMemories?: any[];

  constructor(options: any) {
    const originalFetch = options?.fetch;
    let interceptedFetch = originalFetch;
    let selfRef: MemCell;

    if (originalFetch) {
      interceptedFetch = async (...args: any[]) => {
        const res = await originalFetch(...args);
        try {
          if (typeof res?.clone === "function") {
            const clone = res.clone();
            const json = await clone.json();
            if (json && Array.isArray(json.memories)) {
              selfRef._capturedMemories = json.memories;
            }
          }
        } catch {
          // ignore
        }
        return res;
      };
    }

    super({ ...options, fetch: interceptedFetch });
    selfRef = this;
  }

  async recall(params: any) {
    this._capturedMemories = undefined;
    const res: any = await super.recall(params);
    if (res && typeof res === "object") {
      const captured = this._capturedMemories as any[] | undefined;
      if (captured && captured.length > 0) {
        res.memories = captured;
      } else if (!res.memories && res.items?.length) {
        res.memories = res.items;
      } else if (!res.memories) {
        res.memories = [];
      }
    }
    return res;
  }
}

export { getSdkClient, type SdkClientOptions } from "./sdk-client.js";
