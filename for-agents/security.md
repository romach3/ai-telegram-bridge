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

The bridge assumes one trusted Telegram user and one private chat. Preserve
these invariants before adding new command paths:

- Every Telegram message, slash command, resume action, cancel action, and
  prompt must be ignored unless `from.id === allowedUserId`.
- Private chat is the supported control surface. Group/supergroup/channel
  updates must not start prompts, commands, resumes, or permission decisions.
- Inline permission callbacks must be checked against `allowedUserId`, the
  original chat id, and the original permission message id before sending any
  ACP response.
- Permission callbacks are one-shot. After approve/deny/expiry they must not be
  replayable.
- Startup clears pending permission callbacks and marks interrupted running
  sessions as failed, because a restarted bridge cannot prove that old buttons
  still map to a live ACP request.

Inline permission callbacks are stored with callback ids in `state.ts`. When a
callback is accepted, runtime must answer the same backend and ACP request id
that emitted the permission request.

## Bot Token Ownership

`allowedUserId` protects this bridge instance. It does not protect the Telegram
bot token itself.

One bot token should be used by one bridge instance. If another machine runs the
same token with a different `allowedUserId`, it will not execute commands on
this machine, but it can compete for `getUpdates` polling and make messages
appear to disappear. For another user, create another Telegram bot/token.

Troubleshooting symptom: if the bot sometimes does not respond and local logs
do not show the update, check for another polling consumer or a configured
webhook with BotFather/Telegram `getWebhookInfo`. Rotate the token if ownership
is unclear.

The runtime warns when `getWebhookInfo` reports an active webhook because
polling bridge instances and webhooks are mutually conflicting consumers.

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
