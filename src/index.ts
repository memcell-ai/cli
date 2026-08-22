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
