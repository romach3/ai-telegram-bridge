# ai-telegram-bridge

[![CI](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22%2B-339933)
![ACP](https://img.shields.io/badge/backend-ACP-4b5563)
![Telegram](https://img.shields.io/badge/ui-Telegram-2AABEE)

[English](README.md) | [Русская версия](README.ru.md)

Run your coding agent from Telegram.

`ai-telegram-bridge` turns Telegram into a remote interface for your coding
agent. Send tasks from your phone, watch the live progress message update, reply
to the agent's questions, and approve or deny tool permissions with buttons.
The agent keeps working in your workspace while Telegram becomes the control
panel.

Codex ACP works out of the box if `codex-acp` is available, but the bridge is
not Codex-specific. Any stdio ACP backend can be configured.

## AI-Assisted Install

The easiest setup path is to let a coding agent install it with the project
runbook:

```text
for-agents/install.md
```

The runbook tells the agent how to check or install Node.js, ask for
credentials, check the ACP backend command, write local config, and optionally
set up autostart. It is meant to be interactive.

Codex:

```bash
codex "Read for-agents/install.md and install ai-telegram-bridge interactively."
```

Gemini:

```bash
gemini -p "Read for-agents/install.md and install ai-telegram-bridge interactively."
```

Claude:

```bash
claude "Read for-agents/install.md and install ai-telegram-bridge interactively."
```

## Manual Config

You need a Telegram bot token, your numeric Telegram user id, a workspace path,
and an ACP backend command.

You can configure the bridge with environment variables:

```bash
export AI_TELEGRAM_BOT_TOKEN="..."
export AI_TELEGRAM_ALLOWED_USER_ID="123456"
export AI_TELEGRAM_DEFAULT_CWD="/path/to/workspace"
export AI_TELEGRAM_ACP_COMMAND="codex-acp"
export AI_TELEGRAM_DEFAULT_BACKEND="codex"
```

Or copy the local config template:

```bash
cp bot.example.json bot.json
```

`bot.json` is ignored by git. Keep real tokens there or in env vars, never in
tracked files.

Example backend config:

```json
{
  "defaultBackend": "codex",
  "backends": {
    "codex": {
      "type": "stdio-acp",
      "label": "Codex",
      "command": "codex-acp",
      "args": []
    }
  }
}
```

## Run

```bash
npm install
npm run dev -- serve
```

Production-style run:

```bash
npm run build
npm start -- serve
```

## Telegram Commands

- `/new` creates a new ACP session. If several backends are configured, it
  shows backend buttons first.
- `/resume` shows buttons for the last five resumable sessions.
- `/compact` sends `/compact` to the active ACP session.
- `/status` shows the current bridge/session state.
- `/cancel` cancels the current turn.
- `/help` shows commands.

Any normal text message is sent to the active ACP session as `session/prompt`.
The first normal prompt in a new session becomes its human-readable title in
`/resume`. Debug commands such as `/load`, `/sessions`, and `/backends` exist
for recovery but are intentionally hidden from the Telegram command menu.

## Notes

The bridge talks to ACP backends over newline-delimited JSON-RPC on stdio. The
idea is close to using an ACP agent from an editor such as Zed, except Telegram
is the UI.

## Security

Treat the bridge as remote access to your local coding agent. Use your own
Telegram bot token, keep it private, and run one bridge instance per bot token.
If you want another user to run the bridge, create another Telegram bot for
them. The control surface is a private chat with the configured Telegram user;
group chats are intentionally unsupported. Detailed security notes live in
`for-agents/security.md`.

## Developer Notes

This is an AI-first project: day-to-day installation and maintenance are meant
to be delegated to a coding agent.

`AGENTS.md` and `for-agents/` are written for those agents and maintainers. They
explain the runtime boundaries, file ownership, extension points, verification
commands, and change rules. Keep `README.md` and `README.ru.md` synchronized
when changing user-facing documentation.
