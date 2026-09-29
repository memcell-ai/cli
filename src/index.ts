// The library face of the package: a harness that would rather call the
// loop in-process than shell out imports from here.

export { call, MemcellError, whoami, type Session } from "./client.js";
export { findProject, removeProject, saveProject, type Project } from "./project.js";
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
