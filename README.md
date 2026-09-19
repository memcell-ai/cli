<p align="center">
  <img src="https://memcell.ai/icon.svg" width="56" alt="MemCell Logo" />
</p>

<h1 align="center">memcell</h1>

<p align="center">
  <strong>Persistent, adaptive memory engine for AI agents.</strong><br />
  Stop your agents from repeating the same mistakes across sessions.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memcell"><img src="https://img.shields.io/npm/v/memcell.svg?style=flat" alt="npm version" /></a>
  <a href="https://github.com/memcell-ai/cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node.js >= 20" /></a>
  <a href="https://memcell.ai/docs"><img src="https://img.shields.io/badge/docs-memcell.ai-blue" alt="Documentation" /></a>
</p>

```sh
# Install globally
npm install -g memcell

# In any project:
memcell connect
```

Run it in any project. `memcell connect` automatically:

- **Approves in 1 tap**: Opens browser approval (no upfront account needed; guest memories carry over seamlessly on sign-in).
- **Auto-detects agents**: Wires **Claude Code, Cursor, Copilot CLI, Gemini CLI, OpenAI Codex, OpenCode, Cline, Windsurf**, and more with non-destructive lifecycle hooks and the local stdio MCP server (`memcell mcp`).
- **Secures credentials**: Stores scoped agent keys directly in your OS keyring (Keychain / Secret Service / Credential Manager).
- **Creates `.memcell`**: Adds a clean, git-safe project descriptor to your repo root.

Verify anytime:

```sh
memcell status
```

---

## Why MemCell?

Every time you start a new session with an AI agent, it starts with complete amnesia. It falls into the same traps, repeats outdated assumptions, and recreates issues you already resolved yesterday.

Static instruction files and monolithic system prompts don't solve this:

- **Context Bloat**: Stacking dozens of instructions wastes tokens on every turn and dilutes model attention.
- **Zero Adaptability**: Outdated instructions keep firing even when requirements change.
- **Manual Overhead**: You remain the sole feedback loop, constantly hand-editing markdown files.

**MemCell gives your agents closed-loop memory:**

1. **Pre-Action Recall** — Before taking action, agents receive verified statements relevant to the current task.
2. **Execution & Feedback** — When actions succeed or fail, real outcomes are reported back.
3. **Earned Confidence** — Statements that work gain confidence; statements that fail decay. Zero manual prompt maintenance.

---

## How It Works

MemCell pairs two lightweight layers so agents stay aligned without getting in your way:

- **Deterministic Hooks (Zero-Touch)**: Fire automatically on session start, prompt submit, and turn end. Relevant statements and directives are checked before actions begin—without relying on the model remembering to call a tool. _Hooks fail open in <50ms, so offline or slow networks never block your editor._
- **MCP Tool Bridge (`memcell mcp`)**: Provides interactive tools (`recall`, `remember`, `report`, `ingest`) when agents need to search memory or record discoveries mid-turn.

---

## Everyday Usage

Once connected, agents recall and report memory automatically. You can also interact with memory directly from your terminal:

### 1. Recall Verified Context Before Implementing

```sh
memcell recall "how do we handle multi-tenant database sessions?"
```

### 2. Record a Decision or Convention

```sh
# Record a project convention
memcell remember "Always use pnpm for package operations; never invoke npm directly"

# Bind an invariant to a specific lifecycle trigger
memcell remember "Check database migrations for column locks before altering tables" --at "before db:migrate"
```

### 3. Report What Happened

Memories sharpen when told what happened. When an approach succeeds or fails, report the outcome:

```sh
memcell report stmt_019a4b2c worked --note "CI suite passed cleanly"
memcell report stmt_019a4b2c failed --note "broke Next.js 15 async cookies"
```

### 4. Ingest Specs and Existing Guidelines

```sh
# Ingest an architecture doc, spec, or post-mortem
memcell ingest docs/architecture/auth.md

# Scan and import existing guideline files (CLAUDE.md, etc.)
memcell import
```

### 5. Check Attributed Token Savings

```sh
memcell stats
```

Displays statements followed, errors avoided, estimated tokens saved from prevented error loops, and 30-day activity sparklines.

---

## Supported Agents & IDEs

| Agent / Harness                       | Integration          | How It Runs                                                                                |
| :------------------------------------ | :------------------- | :----------------------------------------------------------------------------------------- |
| **Claude Code**                       | Hooks + MCP + Plugin | Automatic lifecycle hooks or marketplace plugin (`/plugin marketplace add memcell-ai/cli`) |
| **Cursor**                            | Hooks + MCP Bridge   | Native lifecycle hooks in `.cursor/hooks.json` and stdio bridge in `.cursor/mcp.json`      |
| **Gemini CLI**                        | Hooks + MCP          | Session and prompt hooks via native CLI harness                                            |
| **GitHub Copilot CLI**                | Lifecycle Hooks      | Pre-command validation hooks                                                               |
| **OpenAI Codex / OpenCode**           | Hooks + MCP          | Project descriptor hooks and stdio tools                                                   |
| **Cline & Windsurf**                  | MCP Bridge           | Native editor MCP client configuration                                                     |
| **Factory Droid, Devin, Kiro, Goose** | Hooks + MCP          | Workspace adapters and tool harnesses                                                      |

---

## Command Cheat Sheet

| Command                         | Description                                                            |
| :------------------------------ | :--------------------------------------------------------------------- |
| `memcell connect`               | Connect this directory to MemCell, install hooks, and configure MCP    |
| `memcell status`                | Check authentication standing, active project, and connection health   |
| `memcell stats`                 | Show statements followed, errors avoided, and token savings            |
| `memcell recall <intent>`       | Query memory for verified statements and past outcomes before acting   |
| `memcell remember <text>`       | File a project convention or directive (`--at` for lifecycle triggers) |
| `memcell report <id> <outcome>` | Report `worked`, `failed`, or `avoided` to update confidence           |
| `memcell ingest <file>`         | Distill a document or specification into atomic memories               |
| `memcell import [files...]`     | Import existing guideline files (`CLAUDE.md`, etc.)                    |
| `memcell export`                | Export project memories as a portable document (`--format json\|md`)   |
| `memcell orgs`                  | List or switch active organization (`memcell orgs switch <slug>`)      |
| `memcell projects`              | List or switch active project (`memcell projects use <slug>`)          |
| `memcell hook remove`           | Cleanly remove all MemCell hooks from this directory                   |
| `memcell reset`                 | Clear all cached credentials, keys, and tokens on this machine         |

Run `memcell --help` or `memcell <command> --help` for full flag details.

---

## Clean Uninstall

To remove MemCell hooks from a repository without touching your code:

```sh
memcell hook remove
rm .memcell
```

To remove all stored keys and credentials from your local machine:

```sh
memcell reset
```

---

## Links

- **Documentation**: [https://memcell.ai/docs](https://memcell.ai/docs)
- **Website**: [https://memcell.ai](https://memcell.ai)
- **Issues**: [https://github.com/memcell-ai/cli/issues](https://github.com/memcell-ai/cli/issues)

Apache License 2.0 · © 2026 OpenOri
