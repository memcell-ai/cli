<p align="center">
  <img src="https://memcell.ai/icon.svg" width="56" alt="" />
</p>

<h1 align="center">memcell</h1>

<p align="center"><strong>Living memory for AI coding agents.</strong><br />
What this project established, braided with what shipped in your dependencies after the cutoff —<br />
recalled before your agents act, sharpened by the outcomes they report back.</p>

> **Hooks make the loop deterministic. MCP rides beside them as reach.**

```sh
npx memcell connect
```

Run it in a project you code in. It prints a code, one tap in your browser
approves it — no account needed, and a guest's memory carries over on
sign-in. Wires **Claude Code, Cursor, Codex, Gemini CLI, Copilot CLI,
OpenCode, Qwen, Grok, Droid, Kiro, Devin** and more: hooks, the
`memcell mcp` bridge, an agent key for this directory, and `.memcell`.

## Commands

| command               | what it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `memcell connect`     | wire this directory — approves in your browser the first time      |
| `memcell recall`      | what memory serves before you act                                  |
| `memcell remember`    | file one thing this project has established                        |
| `memcell report`      | what happened when something memory served was acted on            |
| `memcell status`      | who this machine is, and what this directory is linked to          |
| `memcell ingest <f>`  | hand a document to this directory's memory                         |
| `memcell import`      | bring existing instruction files into memory — bare, it finds them |
| `memcell export`      | carry this space out — one document, no account needed             |
| `memcell hook remove` | take memcell's hooks out of this directory                         |
| `memcell login`       | sign this machine in                                               |
| `memcell reset`       | forget everything memcell keeps on this machine                    |

| resource           | acts on                                   |
| ------------------ | ----------------------------------------- |
| `memcell config`   | settings, per project or per machine      |
| `memcell spaces`   | what you work on, and which one is active |
| `memcell agents`   | the agents wired to this account          |
| `memcell memories` | the commons                               |

`memcell --help <name>` explains any of them. Ships two binaries:
`memcell` and `mem`.

Undo pairs: `login ⇄ logout` (this machine ⇄ an account),
`connect ⇄ hook remove` (this directory ⇄ a space, with an agent key).
Revoking a credential never forgets what the agents filed.

## How it works

- **Hooks** — recall runs at session start and prompt submit; remember and
  report run at turn end. MCP tool calls are model-invoked with no session
  lifecycle, so they cannot guarantee either moment; hooks fire regardless
  of what the model decides to call. Fails open, always.
- **MCP** — wiring also registers `memcell mcp`, a stdio bridge to the
  paired instance, so the model can ask memory mid-turn. The committed
  entry is just that command: no secret in any config file.
- **`.memcell`** — the instance and the space. Project truth, identical for
  every clone, safe to commit. Keys live in the machine keyring; a teammate
  who clones runs one `npx memcell connect` of their own.

## Options

| option         | what it does                                                          |
| -------------- | --------------------------------------------------------------------- |
| `--instance`   | target a self-hosted memcell; credentials are stored per instance     |
| `--space`      | name which of your spaces to wire, by slug                            |
| `--pair <id>`  | claim a pairing from the connect page instead of the in-terminal flow |
| `--no-browser` | print the approval link instead of opening it                         |

`MEMCELL_INSTANCE` sets the default instance for a shell.

## Claude Code plugin

This repo is also a plugin marketplace:

```
/plugin marketplace add memcell-ai/cli
/plugin install memcell@memcell
```

The plugin registers the MCP bridge and a skill teaching the four doors
(recall, remember, ingest, report). Hooks still come from
`npx memcell connect` — the plugin is reach, the hooks are the loop.

## Links

- Website — https://memcell.ai
- Docs — https://memcell.ai/docs

Apache License 2.0 · © 2026 OpenOri
