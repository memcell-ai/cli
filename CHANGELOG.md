# Changelog

## [0.9.0](https://github.com/memcell-ai/cli/compare/memcell-v0.8.0...memcell-v0.9.0) (2026-09-10)


### Features

* **recall:** hierarchical intent rollup, unmuted before-act, and elevated guards ([#25](https://github.com/memcell-ai/cli/issues/25)) ([7e23e4b](https://github.com/memcell-ai/cli/commit/7e23e4b6791f4c0496f19b67b3fc8c9f304ff241))

## [0.8.0](https://github.com/memcell-ai/cli/compare/memcell-v0.7.0...memcell-v0.8.0) (2026-09-07)


### Features

* **loop:** structure pre-turn memory into tiered guards and enforce syntactic triggers ([256b866](https://github.com/memcell-ai/cli/commit/256b86682b0791d51f56442ea7902a84adfcaa01))

## [0.7.0](https://github.com/memcell-ai/cli/compare/memcell-v0.6.2...memcell-v0.7.0) (2026-09-06)


### Features

* **keyring:** harden ambient agent resolution and sanitize assistant prompts ([72248e4](https://github.com/memcell-ai/cli/commit/72248e4d3546a73c8eb82b61b5eb190703075d22))

## [0.6.2](https://github.com/memcell-ai/cli/compare/memcell-v0.6.1...memcell-v0.6.2) (2026-09-06)


### Bug Fixes

* **keyring:** prune stale keys on connect and isolate agent resolution ([#21](https://github.com/memcell-ai/cli/issues/21)) ([c10c707](https://github.com/memcell-ai/cli/commit/c10c707050cd8c14ca9e58636075a5fbfc79396f))

## [0.6.1](https://github.com/memcell-ai/cli/compare/memcell-v0.6.0...memcell-v0.6.1) (2026-09-06)


### Bug Fixes

* **stats:** describe what the command now prints ([#19](https://github.com/memcell-ai/cli/issues/19)) ([d0c96be](https://github.com/memcell-ai/cli/commit/d0c96be358dacaec119a014a972866dd6b927b33))

## [0.6.0](https://github.com/memcell-ai/cli/compare/memcell-v0.5.0...memcell-v0.6.0) (2026-09-06)


### ⚠ BREAKING CHANGES

* **commands:** `--instance` is removed. Use `--url`.

### Features

* **adapters:** wire antigravity, cline, goose and windsurf ([a017d25](https://github.com/memcell-ai/cli/commit/a017d2588370476d3c10779706f18c47029dba41))


### Code Refactoring

* **commands:** every command that reaches an instance takes --url ([#17](https://github.com/memcell-ai/cli/issues/17)) ([9b184e0](https://github.com/memcell-ai/cli/commit/9b184e04a68e33a85414cff8bbca2f9183296e9a))

## [0.5.0](https://github.com/memcell-ai/cli/compare/memcell-v0.4.0...memcell-v0.5.0) (2026-08-24)


### Features

* **status:** check the credential the hooks actually carry ([#14](https://github.com/memcell-ai/cli/issues/14)) ([d99660c](https://github.com/memcell-ai/cli/commit/d99660cd1ef08a3a581f28f0aa8bf4d47f433674))

## [0.4.0](https://github.com/memcell-ai/cli/compare/memcell-v0.3.2...memcell-v0.4.0) (2026-08-24)


### Features

* **loop:** rules can apply at an act, and refuse it ([#12](https://github.com/memcell-ai/cli/issues/12)) ([dc952d5](https://github.com/memcell-ai/cli/commit/dc952d5eb9bebce7c38c97bf81383830a1b78a8a))

## [0.3.2](https://github.com/memcell-ai/cli/compare/memcell-v0.3.1...memcell-v0.3.2) (2026-08-23)


### Bug Fixes

* **loop:** the turn-end hook hands over instead of waiting ([#10](https://github.com/memcell-ai/cli/issues/10)) ([5fa5ca9](https://github.com/memcell-ai/cli/commit/5fa5ca982c6692e4d9d015d8cdfd0df36c27a203))

## [0.3.1](https://github.com/memcell-ai/cli/compare/memcell-v0.3.0...memcell-v0.3.1) (2026-08-23)


### Bug Fixes

* harden the client and hooks before the public listing ([#8](https://github.com/memcell-ai/cli/issues/8)) ([1e54749](https://github.com/memcell-ai/cli/commit/1e547495514dff1d8b4074a0ab74d8ca5af79598))

## [0.3.0](https://github.com/memcell-ai/cli/compare/memcell-v0.2.0...memcell-v0.3.0) (2026-08-22)


### Features

* **loop:** lead recall with what this session went against ([#6](https://github.com/memcell-ai/cli/issues/6)) ([237caad](https://github.com/memcell-ai/cli/commit/237caadc41630e4b1b4f54a1c9509989d4707e6e))

## [0.2.0](https://github.com/memcell-ai/cli/compare/memcell-v0.1.12...memcell-v0.2.0) (2026-08-22)


### Features

* the memcell CLI, agent adapters, MCP bridge and plugin ([e3f868d](https://github.com/memcell-ai/cli/commit/e3f868dc02a6cefc407be269f8a2bae6d30c61f1))


### Bug Fixes

* **ci:** exclude release-please files from the format check ([#4](https://github.com/memcell-ai/cli/issues/4)) ([97f90df](https://github.com/memcell-ai/cli/commit/97f90dfa99cd6a130c15dc5c02a39890b8521d53))

## Changelog

Versions up to 0.1.12 predate this repository; their notes ship with the
npm package they released.
