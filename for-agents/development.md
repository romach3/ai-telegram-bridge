# Development Notes For Agents

This package is intentionally small. Prefer moving logic to the closest owning
file over creating new broad folders.

## Local Setup

```bash
npm install
```

Local config can come from environment variables or ignored `bot.json`.
`bot.example.json` is the tracked template.

## Docker Setup

The tracked Docker surface is:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.env.example`

The compose workflow is:

```bash
cp .env.example .env
cp bot.example.json bot.json
docker compose up -d --build
```

Update workflow:

```bash
git pull
docker compose up -d --build
```

Keep `data/` in the named `bridge-data` volume. Do not bake local `bot.json`,
runtime `data/`, or host-specific ACP CLI binaries into the default image.
If a backend command must run in Docker, document how that command becomes
available inside the container.

## Verification

Run these after code changes:

```bash
npm test
npm run build
node dist/cli.js --help
```

Useful publish checks:

```bash
rg -n "botToken|allowedUserId|AAG|bot.json|data/" . --glob '!node_modules/**' --glob '!dist/**'
npm pack --dry-run
```

## Live Service

The local development service is a user systemd unit named
`ai-telegram-bridge.service`.

Check status:

```bash
systemctl --user status ai-telegram-bridge.service --no-pager
```

Restart only when requested or when validating live behavior:

```bash
systemctl --user restart ai-telegram-bridge.service
```

Do not restart just because docs or non-runtime files changed.

## Refactor Rules

- Do not create directories for one file.
- Do not add `actions/`, `getters/`, `services/`, `storage/`, or `pipelines/`
  unless there is a concrete multi-file boundary and a clear owner.
- If only `runtime.ts` calls a helper and it is bridge-specific, keep it in
  `runtime.ts` or `state.ts`.
- If a helper is pure and generic, put it in `utils/`.
- If a helper mentions Telegram concepts, put it in `telegram/`.
- If a helper mentions ACP protocol concepts, put it in `backend/acp/`.
- If a shape crosses module boundaries, type it in `types/`.
- Prefer `grammy` primitives for Telegram transport. Do not add new raw
  Telegram Bot API HTTP calls.

## Common Change Locations

- Telegram message formatting: `src/telegram/markdown.ts` and
  `src/telegram/messages.ts`, with Markdown conversion delegated to
  `telegramify-markdown`.
- Bot API method changes: `src/telegram/bot-api.ts`. This file owns `grammy Bot`
  polling/routing and converts Telegram middleware context into bridge DTOs.
- Telegram event shape changes: `src/types/telegram.ts`. Runtime should receive
  bridge DTOs, not raw `grammy` updates.
- Technical status rendering or command behavior: `src/runtime.ts`.
- Session or permission persistence: `src/state.ts`.
- ACP process lifecycle: `src/backend/acp/json-rpc-client.ts`.
- ACP method mapping: `src/backend/acp/stdio-backend.ts`.
- ACP update parsing: `src/backend/acp/events.ts`.
- Backend config defaults: `src/config.ts`.

## Git Hygiene

Stage only files that belong to this package. Never stage ignored local runtime
state such as `bot.json`, `.env`, `data/`, `dist/`, or `node_modules/`.
