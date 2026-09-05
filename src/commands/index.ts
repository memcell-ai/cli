import type { Command, Resource } from "../model.js";
import { listAgents, revokeAgent } from "./agents.js";
import { configGet, configSet } from "./config.js";
import { hook, hookRemove } from "./hook.js";
import { exportSpace } from "./export.js";
import { importFiles } from "./import.js";
import { ingest } from "./ingest.js";
import { recall } from "./recall.js";
import { remember } from "./remember.js";
import { report } from "./report.js";
import { mcp } from "./mcp.js";
import { login } from "./login.js";
import { connect } from "./connect.js";
import { logout } from "./logout.js";
import { reset } from "./reset.js";
import { seed } from "./seed.js";
import { listSpaces, newSpace, useSpace } from "./spaces.js";
import { stats } from "./stats.js";
import { status } from "./status.js";

// Every command the CLI has, declared rather than dispatched by hand.
//
// The switch that used to live in `main.ts` had to be kept in step with a
// help string written separately, so the two drifted: options were listed
// that one command took, commands were listed in an order nothing enforced,
// and a new verb meant editing three places. Here the list IS the help, the
// parser reads the same declarations, and a command that takes a flag says
// so where it says everything else.

/** The nouns, so help groups by resource instead of listing every verb. */
export const RESOURCES: Resource[] = [
  { name: "config", what: "settings, per project or per machine" },
  { name: "spaces", what: "what you work on, and which one is active" },
  { name: "agents", what: "the agents wired to this account" },
  { name: "memories", what: "the commons" },
];

export const COMMANDS: Command[] = [
  {
    path: ["login"],
    what: "sign this machine in",
    takes: ["url", "force", "no-browser"],
    landing: true,
    run: ({ instance, flags }) =>
      login(instance, { force: flags.force === true, noBrowser: flags["no-browser"] === true }),
  },
  {
    path: ["logout"],
    what: "sign out and forget the session here",
    takes: ["url"],
    run: ({ instance }) => logout(instance),
  },
  {
    path: ["connect"],
    what: "wire this directory — approves in your browser the first time",
    takes: ["url", "pair", "space", "agent", "no-browser"],
    landing: true,
    run: ({ instance, from, flags }) =>
      connect(instance, {
        pair: typeof flags.pair === "string" ? flags.pair : undefined,
        space: typeof flags.space === "string" ? flags.space : undefined,
        agent: typeof flags.agent === "string" ? flags.agent : undefined,
        noBrowser: flags["no-browser"] === true,
        from,
      }),
  },
  {
    path: ["hook"],
    what: "what an installed hook runs",
    args: [
      { name: "moment", required: true, what: "the lifecycle moment" },
      { name: "program", required: true, what: "the agent program, for its output format" },
    ],
    // `--agent` is still ACCEPTED and ignored: hooks wired by older
    // releases carry one, and they keep firing until the next install
    // rewrites them. The agent is resolved from the keyring now.
    takes: ["agent"],
    hidden: true,
    run: ({ args }) => hook(args.moment ?? "", args.program ?? ""),
  },
  {
    path: ["hook", "remove"],
    what: "take memcell's hooks out of this directory",
    landing: true,
    run: () => hookRemove(),
  },
  {
    path: ["mcp"],
    what: "the stdio face of this directory's memory, for MCP clients",
    takes: ["dir", "agent"],
    hidden: true,
    run: ({ flags }) =>
      mcp(
        typeof flags.dir === "string" ? flags.dir : undefined,
        typeof flags.agent === "string" ? flags.agent : undefined,
      ),
  },
  {
    path: ["recall"],
    what: "what memory serves before you act",
    args: [{ name: "intent", required: true, what: "what you are trying to do or know" }],
    takes: ["limit", "url"],
    landing: true,
    run: ({ args, flags }) =>
      recall(
        args.intent!,
        typeof flags.limit === "string" ? flags.limit : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["remember"],
    what: "file one thing this project has established — --at names when a rule applies",
    args: [{ name: "text", required: true, what: "the claim, in one sentence" }],
    takes: ["kind", "at", "url"],
    run: ({ args, flags }) =>
      remember(
        args.text!,
        typeof flags.kind === "string" ? flags.kind : undefined,
        typeof flags.at === "string" ? flags.at : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["report"],
    what: "what happened when something memory served was acted on",
    args: [
      { name: "statement", required: true, what: "the statement's id, from recall" },
      { name: "outcome", required: true, what: "worked · failed · avoided" },
    ],
    takes: ["note", "url"],
    run: ({ args, flags }) =>
      report(
        args.statement!,
        args.outcome!,
        typeof flags.note === "string" ? flags.note : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["ingest"],
    what: "hand a document to this directory's memory",
    args: [{ name: "file", required: true, what: "the document to distill" }],
    takes: ["url"],
    landing: true,
    run: ({ args, flags }) =>
      ingest(args.file!, typeof flags.url === "string" ? flags.url : undefined),
  },
  {
    path: ["import"],
    what: "bring existing instruction files into memory — bare, it finds them",
    args: [{ name: "files", rest: true, what: "documents or a JSON export to distill" }],
    takes: ["url"],
    landing: true,
    run: ({ many, flags }) =>
      importFiles(many.files ?? [], typeof flags.url === "string" ? flags.url : undefined),
  },
  {
    path: ["export"],
    what: "carry this space out — one document, no account needed",
    takes: ["format", "out", "url"],
    landing: true,
    run: ({ flags }) =>
      exportSpace(
        typeof flags.format === "string" ? flags.format : "json",
        typeof flags.out === "string" ? flags.out : undefined,
        typeof flags.url === "string" ? flags.url : undefined,
      ),
  },
  {
    path: ["stats"],
    what: "what the window did — recalls, dead ends, the commons",
    takes: ["url"],
    run: ({ instance }) => stats(instance),
  },
  {
    path: ["status"],
    what: "who this machine is, and what this directory is linked to",
    takes: ["url"],
    landing: true,
    run: ({ instance, from }) => status(instance, from),
  },
  {
    path: ["reset"],
    what: "forget everything memcell keeps on this machine",
    takes: ["force"],
    landing: true,
    run: ({ flags }) => reset(flags.force === true),
  },

  {
    path: ["config", "get"],
    what: "what a setting is here, and which file said so",
    args: [{ name: "key", required: true, what: "a dotted path, e.g. recall.limit" }],
    takes: ["global"],
    run: ({ args, flags }) => configGet(args.key!, flags.global === true),
  },
  {
    path: ["config", "set"],
    what: "set it for this project, or for this machine",
    args: [
      { name: "key", required: true, what: "a dotted path, e.g. recall.limit" },
      { name: "value", required: true, what: "the value to store" },
    ],
    takes: ["global"],
    run: ({ args, flags }) => configSet(args.key!, args.value!, flags.global === true),
  },

  {
    path: ["spaces", "ls"],
    what: "list them",
    takes: ["url"],
    run: ({ instance }) => listSpaces(instance),
  },
  {
    path: ["spaces", "new"],
    what: "make one",
    args: [{ name: "name", required: true, what: "what it holds the truth about" }],
    takes: ["url"],
    run: ({ instance, args }) => newSpace(instance, args.name!),
  },
  {
    path: ["spaces", "use"],
    what: "work on this one from now on, everywhere",
    args: [{ name: "slug", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => useSpace(instance, args.slug!),
  },

  {
    path: ["agents", "ls"],
    what: "list them",
    takes: ["url"],
    run: ({ instance }) => listAgents(instance),
  },
  {
    path: ["agents", "revoke"],
    what: "take one agent's key back",
    args: [{ name: "id", required: true, what: "from the list" }],
    takes: ["url"],
    run: ({ instance, args }) => revokeAgent(instance, args.id!),
  },

  {
    path: ["memories", "seed"],
    what: "put a source into the commons, or propose one",
    args: [{ name: "source", required: true, what: "a repository or documentation URL" }],
    takes: ["url", "reason", "no-watch"],
    run: ({ instance, args, flags }) =>
      seed(instance, args.source, {
        reason: typeof flags.reason === "string" ? flags.reason : undefined,
        watch: flags["no-watch"] !== true,
      }),
  },
];
