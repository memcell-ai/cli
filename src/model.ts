// What the CLI is, stated once so every command inherits it.
//
// The commands used to grow one at a time, and it showed: `keys` was a
// group with a sub-verb, `seed` took a bare positional, the rest were flat
// verbs, and the parser was positional-only — so a command needing two
// arguments had to be special-cased. Three shapes for three commands, and
// each new one had to invent a fourth.
//
// There are exactly two shapes now, and the line between them is not a
// style preference:
//
//   memcell <verb>                 acts on THIS machine or THIS directory
//   memcell <resource> <verb> …    acts on something a memcell holds
//
// A bare verb has nothing to name because its subject is where you are
// standing — `login` is this machine, `connect` is this directory. Everything
// else names the resource it touches, and that name is the same word the
// API path uses and the app route uses. So a verb that cannot say which
// resource it acts on is the signal that the resource model is short one,
// rather than an invitation to name it something.
//
// The two pairs are true inverses, and they are inverses of DIFFERENT
// things:
//
//   login   ⇄ logout        this machine ⇄ an account
//   connect ⇄ hook remove   this directory ⇄ a space, with an agent key
//
// `hook remove` undoes the wiring `connect` made; the key it minted is
// revoked with `agents revoke`, by id, which is why the mint records one.

export interface Argument {
  name: string;
  /** Refusing here, uniformly, beats each command inventing its own message. */
  required?: boolean;
  /** Last argument only: collects every remaining word. The invocation's
   *  `many` record holds the list, same as a repeatable flag's. */
  rest?: boolean;
  what: string;
}

export interface FlagSpec {
  name: string;
  short?: string;
  /** The value's name in help. Absent means it is a switch. */
  takes?: string;
  /** May be given more than once; the invocation collects every value. */
  many?: boolean;
  what: string;
  env?: string;
}

/** Every flag the CLI understands, declared once. A command lists the ones
 *  it accepts, so `--reason` on a command that ignores it is an error rather
 *  than silence. */
export const FLAGS: Record<string, FlagSpec> = {
  url: {
    name: "url",
    short: "u",
    takes: "url",
    what: "which memcell to talk to",
    env: "MEMCELL_INSTANCE",
  },
  agent: { name: "agent", takes: "id", what: "the wired agent's id" },
  project: {
    name: "project",
    short: "p",
    takes: "slug",
    what: "which project to target, by slug or owner/slug",
  },
  workspace: {
    name: "workspace",
    short: "w",
    takes: "slug",
    what: "which workspace to target, by slug or owner/slug",
  },
  space: { name: "space", takes: "slug", what: "which space to connect to, by slug" },
  force: { name: "force", short: "f", what: "do it again even if it is already done" },
  "no-browser": {
    name: "no-browser",
    what: "print the link instead of opening one",
    env: "MEMCELL_NO_BROWSER",
  },
  reason: { name: "reason", takes: "why", what: "why the commons should carry it" },
  "no-watch": { name: "no-watch", what: "do not follow the crawl" },
  global: { name: "global", short: "g", what: "this machine, rather than this project" },
  pair: { name: "pair", takes: "id", what: "the pairing shown on the connect page" },
  format: {
    name: "format",
    takes: "format",
    what: "json · agents-md · claude-md · cursorrules",
  },
  out: { name: "out", short: "o", takes: "file", what: "write here instead of stdout" },
  limit: {
    name: "limit",
    short: "n",
    takes: "count",
    what: "how many MATCHED statements to serve — pins ride on top",
  },
  type: {
    name: "type",
    takes: "type",
    what: "guard · directive · fact · preference · observation",
  },
  note: { name: "note", takes: "text", what: "what happened, in a sentence" },
  dir: { name: "dir", takes: "path", what: "which directory to act on" },
  name: { name: "name", takes: "title", what: "display name for the resource" },
  at: { name: "at", takes: "moments", what: "comma-separated lifecycle moments" },
  scope: {
    name: "scope",
    takes: "scope",
    what: "operational scope (e.g. common, domain:<slug>, session:<id>)",
  },
  scopes: { name: "scopes", takes: "scopes", what: "comma-separated operational scopes" },
  meta: { name: "meta", takes: "json", what: "structured JSON metadata" },
  to: { name: "to", takes: "scope", what: "target scope to promote to (default: common)" },
  owner: { name: "owner", takes: "slug", what: "owner (user or organization slug)" },
  status: { name: "status", takes: "status", what: "status filter or state" },
  query: { name: "query", short: "q", takes: "text", what: "search query filter" },
  cursor: { name: "cursor", takes: "cursor", what: "pagination cursor" },
  page: { name: "page", takes: "number", what: "page number for pagination" },
  role: { name: "role", takes: "role", what: "role (e.g. read, write, admin, owner, member)" },
  into: { name: "into", takes: "target", what: "target project namespace to adopt into" },
  timeframe: {
    name: "timeframe",
    takes: "window",
    what: "telemetry timeframe: 24h · 7d · 30d · all",
  },
  description: { name: "description", takes: "text", what: "description of the resource" },
  text: { name: "text", takes: "statement", what: "statement text content" },
  expires: { name: "expires", takes: "days", what: "token expiration duration in days" },
  "dry-run": {
    name: "dry-run",
    what: "preview what would be imported without writing to memory",
  },
  json: {
    name: "json",
    what: "output results as JSON",
  },
  "min-similarity": {
    name: "min-similarity",
    takes: "float",
    what: "minimum cosine similarity threshold for clustering (default: 0.80)",
  },
  "min-cluster-size": {
    name: "min-cluster-size",
    takes: "count",
    what: "minimum statements per cluster (default: 2)",
  },
  "max-cluster-size": {
    name: "max-cluster-size",
    takes: "count",
    what: "maximum statements per cluster (default: 8)",
  },
  wait: {
    name: "wait",
    what: "wait for background job completion and stream progress (default: true)",
  },
  "no-wait": {
    name: "no-wait",
    what: "submit consolidation job asynchronously without waiting",
  },
  all: {
    name: "all",
    what: "delete all versions instead of only the latest version",
  },
  roles: { name: "roles", takes: "roles", what: "comma-separated required roles" },
  subject: { name: "subject", takes: "subject", what: "statement subject or target actor" },
  target: { name: "target", takes: "target", what: "target subject or entity" },
  confidence: { name: "confidence", takes: "float", what: "confidence threshold" },
  sso: { name: "sso", takes: "provider", what: "SSO provider name or domain" },
  "my-memory": { name: "my-memory", what: "filter or create in personal memory scope" },
  my: { name: "my", what: "filter or create in personal memory scope" },
  metadata: { name: "metadata", takes: "json", what: "structured JSON metadata" },
  kind: { name: "kind", takes: "kind", what: "reflex · episodic" },
  "provider-id": { name: "provider-id", takes: "id", what: "SSO provider ID" },
  provider: { name: "provider", takes: "provider", what: "SSO identity provider type" },
  domain: { name: "domain", takes: "domain", what: "associated email domain" },
  "metadata-url": { name: "metadata-url", takes: "url", what: "SAML metadata URL" },
  "metadata-xml": { name: "metadata-xml", takes: "xml", what: "SAML metadata XML content" },
  "client-id": { name: "client-id", takes: "id", what: "OIDC client ID" },
  "client-secret": { name: "client-secret", takes: "secret", what: "OIDC client secret" },
  issuer: { name: "issuer", takes: "url", what: "OIDC discovery issuer URL" },
  "authorization-endpoint": {
    name: "authorization-endpoint",
    takes: "url",
    what: "OIDC authorization endpoint",
  },
  "token-endpoint": { name: "token-endpoint", takes: "url", what: "OIDC token endpoint" },
  "user-info-endpoint": {
    name: "user-info-endpoint",
    takes: "url",
    what: "OIDC userinfo endpoint",
  },
  "jwks-uri": { name: "jwks-uri", takes: "url", what: "JSON Web Key Set URI" },
  enable: { name: "enable", what: "enable SSO provider" },
  disable: { name: "disable", what: "disable SSO provider" },
  off: { name: "off", what: "disable the feature or setting" },
  org: { name: "org", takes: "slug", what: "organization slug" },
  team: { name: "team", takes: "slug", what: "team slug" },
  slug: { name: "slug", takes: "slug", what: "resource slug" },
  health: { name: "health", what: "filter or display health status" },
  framework: { name: "framework", takes: "name", what: "framework name" },
  model: { name: "model", takes: "model", what: "model name" },
  "no-key": { name: "no-key", what: "do not generate an API key" },
  permission: { name: "permission", takes: "perm", what: "permission level" },
  actor: { name: "actor", takes: "id", what: "actor ID" },
  "actor-type": { name: "actor-type", takes: "type", what: "user or agent" },
  action: { name: "action", takes: "action", what: "audit action name" },
  "target-type": { name: "target-type", takes: "type", what: "target entity type" },
  "target-id": { name: "target-id", takes: "id", what: "target entity ID" },
  from: { name: "from", takes: "timestamp", what: "start timestamp or date" },
};

/** Universal flags accepted across all commands without throwing unknown flag errors. */
export const GLOBAL_FLAGS = new Set(["url", "workspace", "project", "owner", "json"]);

export interface ResolvedProject {
  owner?: string;
  project: string;
  workspace?: string;
  namespace: string;
  projectId?: string;
  workspaceId?: string;
  at?: string;
  source: "flag" | "file" | "config" | "active";
}

export type ResolvedWorkspace = ResolvedProject;

export interface ResolvedContext {
  instance: string;
  from: string;
  credential: { token: string; obtainedAt?: string } | null;
  project: ResolvedProject | null;
  workspace?: ResolvedProject | null;
  owner: string | null;
}

export interface CommandRequirements {
  /** Whether the user must be authenticated with the instance.
   *  - "required": Command halts if not logged in.
   *  - "optional": Auth token passed if present, but unauthenticated execution is allowed.
   *  - "none": Auth is completely irrelevant (e.g. login, help, version, reset).
   */
  auth?: "required" | "optional" | "none";

  /** Whether the command requires an active project / workspace / namespace context.
   *  - "required": Command halts if no project/workspace can be resolved.
   *  - "optional": Resolves project/workspace if possible, but command can proceed without it.
   *  - "none": No project/workspace needed (e.g. projects list, orgs list, account).
   */
  project?: "required" | "optional" | "none";
  workspace?: "required" | "optional" | "none";
}

export interface Invocation {
  instance: string;
  /** What decided `instance` — flag · env · project · global · last
   *  connected · default. Resolved once, at the entry point: a command that
   *  re-derives it without the flag reports the wrong reason beside the
   *  right host. */
  from: string;
  args: Record<string, string>;
  flags: Record<string, string | true>;
  /** Every value given for a repeatable flag or a rest argument, in order. */
  many: Record<string, string[]>;
  context?: ResolvedContext;
}

export interface Command {
  /** `["link"]` or `["agents", "revoke"]` — the words, in order. */
  path: string[];
  what: string;
  /** Machine-facing: absent from help, silent on refusal. The hook is one —
   *  its stdout belongs to an agent's parser, not to a person. */
  hidden?: boolean;
  args?: Argument[];
  /** Keys of `FLAGS`. */
  takes?: string[];
  /** Shown on the bare `memcell` screen. Three, so it tells a story. */
  landing?: boolean;
  require?: CommandRequirements;
  run(invocation: Invocation): Promise<number>;
}

/** A resource, so help groups by the noun rather than listing thirty verbs. */
export interface Resource {
  name: string;
  what: string;
}
