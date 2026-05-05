# AGENTS.md

## Project Overview

`ai-telegram-bridge` is a Telegram Bot API bridge for controlling one live
ACP agent session. It forwards Telegram prompts, cancellation requests,
permission decisions, technical status, and final answers between one allowed
Telegram user and configured ACP agents.

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
npm run coverage
npm run build
node dist/cli.js --help
```

`npm test` runs TypeScript typecheck, `biome check`, and the Vitest suite.
Coverage thresholds are a deliberately honest all-files baseline; raise them
only when adding meaningful runtime or Telegram API tests.

## Documentation Rules

- `README.md` and `README.ru.md` are multilingual user entrypoints. Keep them
  structurally consistent and update both files in the same change.
- Keep README concise: explain what the bridge is, how an agent installs it,
  and how to run it manually.
- Put implementation details, verification rules, testing policy, and extension
  guidance in `AGENTS.md` or `for-agents/`, not in README.
- If CI, supported runtime, or public project status changes, update the README
  badges in both languages.

## Architecture Map

- `src/cli.ts` - CLI argument parsing and command entrypoints.
- `src/config.ts` - env var and `bot.json` config loading.
- `src/runtime.ts` - main bridge loop, Telegram command routing, active-turn
  state, permission callbacks, live status rendering, and ACP dispatch.
- `src/state.ts` - persisted bridge sessions and pending permissions.
- `src/acp/stdio-agent.ts` - agent setup.
- `src/acp/` - built-in stdio ACP agent, JSON-RPC client, ACP event
  parsing, and ACP event logging.
- `src/telegram/` - Telegram Bot API, formatting, markdown conversion, message
  chunking/editing, and Telegram polling offset.
- `src/types/` - shared cross-module contracts.
- `src/utils/` - small generic helpers only.

## Public Contracts

These surfaces are part of the bridge contract and must not change casually:

- CLI commands and exit behavior exposed by `ai-telegram-bridge`.
- `bot.example.json` config shape and matching environment variables.
- Telegram commands visible to the allowed user.
- Telegram permission button callback semantics.
- ACP session lifecycle: `/new`, `/resume`, `/compact`, `/cancel`, active turn
  handling, and one-shot permission decisions.
- Runtime files under ignored `data/`.
- User-facing README content in both languages.

If a public contract changes, update README, `for-agents/`, config examples,
and tests in the same change.

## Code Style

- Keep layers compressed. Do not create wrapper directories for one file.
- Do not recreate broad folders such as `actions/`, `getters/`, `storage/`,
  `services/`, or `pipelines/` unless there is a concrete multi-file boundary.
- Put behavior near the owning runtime surface:
  - Telegram behavior in `src/telegram/`.
  - ACP behavior in `src/acp/`.
  - Agent selection in `src/acp/stdio-agent.ts`.
  - Bridge orchestration in `src/runtime.ts`.
  - Bridge session/permission persistence in `src/state.ts`.
  - Generic helpers in `src/utils/`.
- Add or update `src/types/` contracts before threading loose objects across
  modules.

## Runtime Invariants

- Use ACP as the primary agent transport. Do not fall back to PTY scraping or
  CLI resume commands for normal operation.
- Only process Telegram updates from `allowedUserId`.
- Treat private chat with that allowed user as the only supported control
  surface; group/supergroup updates must not execute bridge commands.
- Keep exactly one active prompt turn per Telegram chat.
- Keep the visible Telegram command surface small: `/new`, `/resume`,
  `/status`, `/compact`, `/cancel`, and `/help`. `/agents` is the only hidden
  debug command.
- `/new` must not accept arbitrary `cwd` from Telegram. Use configured
  `defaultCwd`; when multiple agents exist, choose agent via buttons.
- The first normal prompt in a session becomes its `label`; slash commands such
  as `/compact` must not rename sessions.
- `/resume` must hide sessions whose agent is no longer configured and prune
  those invalid records from state. Legacy records without `agentId` may be
  migrated to the configured default agent.
- Route ACP permission requests to Telegram inline buttons and answer the same
  agent/request id that emitted them.
- Permission callbacks must be one-shot and bound to the original chat/message.
- Keep final user-facing answers separate from transient technical status.
- Do not restart the service for docs-only changes.

## Change Workflow

- Start from the owning runtime surface: Telegram behavior in
  `src/telegram/`, ACP behavior in `src/acp/`, orchestration in
  `src/runtime.ts`.
- Keep changes narrow and test the behavior at the closest layer first.
- For Telegram UX changes, prefer deterministic formatting/message tests before
  live service checks.
- Restart `ai-telegram-bridge.service` only for live runtime validation or when
  explicitly requested.
- When changing commands or permissions, check stale callback behavior and
  unauthorized-user behavior.

## Security

- Never commit `bot.json`, `data/*`, `dist/`, or `node_modules/`.
- Treat ACP agent commands as local code execution with the service user's
  permissions.
- `data/acp-events.jsonl` may contain full tool outputs and should be treated as
  sensitive debug data.

## Detailed Agent Notes

Use these files for deeper implementation context:

- `for-agents/architecture.md` - runtime flow, file ownership, rendering model,
  and persistence model.
- `for-agents/acp-agents.md` - stdio ACP agent rules.
- `for-agents/development.md` - verification, service workflow, refactor rules,
  and common change locations.
- `for-agents/install.md` - interactive install/bootstrap runbook for agents.
- `for-agents/security.md` - secrets, access control, runtime files, and
  pre-commit scans.
- `for-agents/systemd.md` - user service conventions.

## Git Hygiene

Stage only files that belong to this package. Never stage ignored local runtime
state such as `bot.json`, `data/`, `dist/`, or `node_modules/`.
