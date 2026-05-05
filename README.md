# ai-telegram-bridge

[English](README.md) | [Русская версия](README.ru.md)

Control an ACP agent from Telegram.

`ai-telegram-bridge` connects a Telegram bot to an ACP backend. You send a
message in Telegram, the bridge forwards it to the active ACP session, and the
answer comes back into the same chat. Permission prompts become Telegram
buttons, progress is shown as an editable status message, and `/cancel` stops
the current turn.

Codex ACP works out of the box if `codex-acp` is available, but the bridge is
not Codex-specific. Any stdio ACP backend can be configured.

## AI-Assisted Install

The easiest setup path is to let a coding agent install it with the project
runbook:

```text
for-agents/install.md
```

The runbook tells the agent how to ask for credentials, choose Node or Docker,
check the ACP backend command, write local config, and optionally set up
autostart. It is meant to be interactive.

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

## Run With Node

```bash
npm install
npm run dev -- serve
```

Production-style run:

```bash
npm run build
npm start -- serve
```

## Run With Docker

Docker is useful when you do not want to install Node on the host:

```bash
cp .env.example .env
cp bot.example.json bot.json
docker compose up -d --build
```

After updating the repo:

```bash
git pull
docker compose up -d --build
```

Runtime state lives in the `bridge-data` Docker volume. The compose file mounts
`bot.json` read-only and mounts `AI_TELEGRAM_WORKSPACE` at `/workspace`.

One important detail: the Docker image contains the bridge, not every possible
ACP backend. If your backend command is `codex-acp`, `gemini-acp`, or something
custom, that command must exist inside the container too. Use a custom image,
mount a binary, or use host Node mode.

## Telegram Commands

- `/new [backend] [cwd]` creates a new ACP session.
- `/resume` shows buttons for the last five local sessions.
- `/compact` sends `/compact` to the active ACP session.
- `/load <sessionId> [backend] [cwd]` loads an existing session.
- `/status` shows the current bridge/session state.
- `/sessions` lists locally known sessions.
- `/backends` lists configured ACP backends.
- `/cancel` cancels the current turn.
- `/help` shows commands.

Any normal text message is sent to the active ACP session as `session/prompt`.

## Notes

The bridge talks to ACP backends over newline-delimited JSON-RPC on stdio. The
idea is close to using an ACP agent from an editor such as Zed, except Telegram
is the UI.

## Developer Notes

`AGENTS.md` and `for-agents/` are written for coding agents and maintainers.
They explain the runtime boundaries, file ownership, extension points, and
change rules.
