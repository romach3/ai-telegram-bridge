# AGENTS.md

## Project Overview

`ai-telegram-bridge` is a Telegram Bot API bridge for controlling one live
ACP backend session. It forwards Telegram prompts, cancellation requests,
permission decisions, technical status, and final answers between one allowed
Telegram user and configured ACP backends.

Treat this package as transport infrastructure. Do not put course-production,
Gemini model fallback, prompt templates, or provider-specific task runners here.

## Setup Commands

```bash
npm install
```

Use environment variables for local secrets when possible. If a local config
file is needed, copy `bot.example.json` to ignored `bot.json`.

## Run Commands

```bash
npm run dev -- serve
npm start -- serve
node dist/cli.js --help
node dist/cli.js probe acp
```

The local user service is `ai-telegram-bridge.service`. Restart it only when
explicitly requested or when validating live runtime behavior:

```bash
systemctl --user restart ai-telegram-bridge.service
systemctl --user status ai-telegram-bridge.service --no-pager
```

## Test Commands

Run after code changes:

```bash
npm test
npm run lint
npm run format:check
npm run build
node dist/cli.js --help
```

`npm test` runs TypeScript typecheck and `biome check`.

## Architecture Map

- `src/cli.ts` - CLI argument parsing and command entrypoints.
- `src/config.ts` - env var and `bot.json` config loading.
- `src/runtime.ts` - main bridge loop, Telegram command routing, active-turn
  state, permission callbacks, live status rendering, and ACP dispatch.
- `src/state.ts` - persisted bridge sessions and pending permissions.
- `src/backend/registry.ts` - backend type dispatch.
- `src/backend/acp/` - built-in stdio ACP backend, JSON-RPC client, ACP event
  parsing, and ACP event logging.
- `src/backend/custom/` - extension point for custom backend implementations.
- `src/telegram/` - Telegram Bot API, formatting, markdown conversion, message
  chunking/editing, and Telegram polling offset.
- `src/types/` - shared cross-module contracts.
- `src/utils/` - small generic helpers only.

## Code Style

- Keep layers compressed. Do not create wrapper directories for one file.
- Do not recreate broad folders such as `actions/`, `getters/`, `storage/`,
  `services/`, or `pipelines/` unless there is a concrete multi-file boundary.
- Put behavior near the owning runtime surface:
  - Telegram behavior in `src/telegram/`.
  - ACP behavior in `src/backend/acp/`.
  - Backend selection in `src/backend/registry.ts`.
  - Bridge orchestration in `src/runtime.ts`.
  - Bridge session/permission persistence in `src/state.ts`.
  - Generic helpers in `src/utils/`.
- Add or update `src/types/` contracts before threading loose objects across
  modules.

## Runtime Invariants

- Use ACP as the primary backend transport. Do not fall back to PTY scraping or
  CLI resume commands for normal operation.
- Only process Telegram updates from `allowedUserId`.
- Keep exactly one active prompt turn per Telegram chat.
- Route ACP permission requests to Telegram inline buttons and answer the same
  backend/request id that emitted them.
- Keep final user-facing answers separate from transient technical status.
- Do not restart the service for docs-only changes.

## Security

- Never commit `bot.json`, `data/*`, `dist/`, or `node_modules/`.
- Treat ACP backend commands as local code execution with the service user's
  permissions.
- `data/acp-events.jsonl` may contain full tool outputs and should be treated as
  sensitive debug data.

## Detailed Agent Notes

Use these files for deeper implementation context:

- `for-agents/architecture.md` - runtime flow, file ownership, rendering model,
  and persistence model.
- `for-agents/backends.md` - stdio ACP backend and custom backend extension
  rules.
- `for-agents/development.md` - verification, service workflow, refactor rules,
  and common change locations.
- `for-agents/install.md` - interactive install/bootstrap runbook for agents.
- `for-agents/security.md` - secrets, access control, runtime files, and
  pre-commit scans.
- `for-agents/systemd.md` - user service conventions.

## Git Hygiene

Stage only files that belong to this package. Never stage ignored local runtime
state such as `bot.json`, `.env`, `data/`, `dist/`, or `node_modules/`.
