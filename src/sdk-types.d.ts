import "@memcell/sdk";

declare module "@memcell/sdk" {
  export interface RecallResponse {
    memories: any[];
  }
  export interface MemCell {
    memories: any;
    workspaces: any;
  }
}
