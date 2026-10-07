import "@memcell/sdk";

declare module "@memcell/sdk" {
  export interface RecallResponse {
    memories: any[];
  }
  export interface MemCell {
    memories: any;
    workspaces: any;
    webhooks: any;
    operator: any;
    invitations: any;
    teams: any;
    forOrg: (orgSlug: string) => any;
    forOrganization: (orgSlug: string) => any;
    insights: any;
  }
}
