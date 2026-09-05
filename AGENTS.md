# Working in this repo

The `memcell` CLI: the terminal face of [memcell](https://memcell.ai),
persistent memory for AI coding agents. One package, published to npm as
`memcell` (`mem` is an alias). This file is the operating guide for coding
agents; humans start at [README.md](./README.md).

This repo is **Apache-2.0**. The hosted platform behind it is licensed
separately — what lives here is the client: the CLI, the agent adapters, the
hook runtime, and the MCP bridge.

## Layout

| Path            | What                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `src/`          | the CLI — commands, parser, keyring, project wiring                                        |
| `src/commands/` | one file per command; `index.ts` is the registry the parser reads                          |
| `src/adapters/` | one file per supported agent — hooks, dialect, session record, and the surface it declares |
| `src/loop/`     | the hook runtime: capture, recall, hand-over                                               |
| `test/`         | vitest suites                                                                              |
| `plugins/`      | the Claude Code plugin (marketplace at `.claude-plugin/`)                                  |
| `server.json`   | the MCP registry manifest                                                                  |

## Commands

```sh
pnpm install
pnpm run build         # tsc → dist/
pnpm run typecheck
pnpm run test          # vitest
pnpm run format:check  # prettier
```

## The skill has two homes

`plugins/memcell/SKILL.md` is the source; the same text is compiled into the
package as a string, because `dist/` ships without `plugins/`. After editing
or reformatting the markdown, run `pnpm run sync:skill` (`pnpm run format`
does it for you). `test/skill.test.ts` fails if the two drift — two
different instructions under one name is worse than either.

## Conventions

- **Conventional commits, terse.** Title plus a few functional lines at
  most: what changed, why. No essays.
- **Comments state constraints.** If a comment does not tell the next
  reader something the code cannot, delete it.
- **One voice.** All human-facing output goes through the segment system in
  `src/ui.ts` — never `console.log` in a command. `test/ui.test.ts`
  enforces this. Payloads use `emit()`, receipts use `aside()`.
- **The registry is the contract.** A command is declared once in
  `src/commands/index.ts` — the parser, help, and downstream docs all read
  that declaration. New flags are declared in `src/model.ts`.
- **Fail open in hooks.** A hook that cannot reach the instance must never
  block the user's agent. Errors are logged, never thrown past the hook
  boundary.
- Releases ride release-please: merge to `main` with conventional titles;
  never hand-edit the version or CHANGELOG.

## Testing against an instance

Suites run hermetically — filesystem and network are faked at seams
(`OpenSlice`, fetch stubs). To try the CLI against a real instance, run any
memcell server and `node dist/bin.js connect --url <url>`.
