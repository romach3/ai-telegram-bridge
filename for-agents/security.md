# Security Notes For Agents

The bridge is designed for one trusted Telegram user controlling local ACP
backends. Treat every configured backend command as local code execution with
the service user's permissions.

## Secrets

- Prefer env vars for secrets.
- If a file is needed, use ignored `bot.json`.
- Never commit `bot.json`.
- Never commit real Telegram bot tokens, user ids tied to private deployments,
  session ids, permission state, or event logs.

Relevant env vars:

- `AI_TELEGRAM_BOT_TOKEN`
- `AI_TELEGRAM_ALLOWED_USER_ID`
- `AI_TELEGRAM_DEFAULT_CWD`
- `AI_TELEGRAM_DEFAULT_BACKEND`
- `AI_TELEGRAM_ACP_COMMAND`
- `AI_TELEGRAM_ACP_COMMAND`
- `AI_TELEGRAM_ACP_EVENT_LOG`

## Access Control

`runtime.ts` ignores Telegram messages unless `message.from.id` equals
`allowedUserId`. Preserve this check before adding new command paths.

Inline permission callbacks are stored with callback ids in
`state.ts`. When a callback is accepted, runtime must answer the same
backend and ACP request id.

## Runtime Files

Ignored files:

- `bot.json`
- `data/*`
- `dist/`
- `node_modules/`

`data/acp-events.jsonl` may include full ACP payloads and tool outputs. Treat it
as sensitive debugging data.

## Pre-Commit Scan

Before publishing or sharing a branch:

```bash
git status --short
rg -n "AAG|botToken|magicUrl|token=|allowedUserId" . --glob '!node_modules/**' --glob '!dist/**'
```
