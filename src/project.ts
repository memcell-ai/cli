export * from "./workspace.js";
export {
  WORKSPACE_FILE as PROJECT_FILE,
  WORKSPACE_FILE_ASIDE as PROJECT_FILE_ASIDE,
  findWorkspace as findProject,
  findWorkspaceFromRoots as findProjectFromRoots,
  saveWorkspace as saveProject,
  removeWorkspace as removeProject,
  setWorkspacePaused as setProjectPaused,
} from "./workspace.js";
export type { Workspace as Project } from "./workspace.js";
