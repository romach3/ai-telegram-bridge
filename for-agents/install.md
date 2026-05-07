# Interactive Install Runbook For Agents

You are installing `ai-telegram-bridge` for a human operator. This file is a
prompt-runbook, not a shell script. Follow it interactively and adapt commands
to the host OS.

## Goal

Install and start `ai-telegram-bridge` so one allowed Telegram user can control
one configured ACP agent through a Telegram bot.

End state:

- Node.js 22+ and npm are available on the host.
- Local config exists without committing secrets.
- The Telegram bot token and allowed user id are configured.
- At least one ACP agent command is configured and verified on the host.
- The bridge can start.
- Optional autostart/autorestart is configured only after explicit approval.
- The user knows how to update, inspect logs, and stop the service.

## Non-Negotiable Safety Rules

- Do not commit secrets.
- Do not print the full Telegram bot token back to the user after receiving it.
- Do not write secrets to tracked files.
- Do not overwrite an existing `bot.json` or systemd unit without showing the
  current path and asking first.
- Do not install Node, system packages, global npm packages, or service units
  without explicit confirmation.
- Do not assume `codex-acp`, Gemini ACP, Claude, or any agent command exists.
  Verify the selected agent command on the host.
- Do not start a long-running service until config and agent command checks
  have passed.

## Initial Questions

Ask these questions before making changes:

1. Agent command:
   - default `codex-acp`
   - another ACP command
2. Workspace path:
   - path the agent should use as its default working directory
3. Autostart:
   - no autostart
   - systemd user service
4. Credentials:
   - Telegram bot token
   - allowed Telegram user id

If the user does not know where to get credentials, explain:

- Create a bot with Telegram `@BotFather`.
- Copy the bot token from BotFather.
- Get the numeric user id from a trusted Telegram id bot or from Telegram update
  metadata. The bridge only accepts messages from this exact id.

## Host Discovery

Run lightweight checks:

```bash
pwd
uname -a
command -v node || true
node --version || true
command -v npm || true
npm --version || true
command -v systemctl || true
systemctl --user status >/dev/null 2>&1; echo $?
```

Interpretation:

- The bridge requires Node.js 22+ and npm on the host.
- Local ACP CLIs such as Codex, Gemini, or Claude generally require host Node.js
  too, so Docker is not a supported install path for this package.
- systemd autostart needs a working `systemctl --user`.

If Node.js or npm is missing or too old, ask before installing it. Use the
host's package manager or the user's preferred Node manager. Do not guess the
package manager when uncertain; inspect the OS first.

## Config File

Package directory:

```bash
.
```

Ignored local config files:

- `bot.json`
- `data/*`

If `bot.json` does not exist:

```bash
cp bot.example.json bot.json
```

Edit config with a real JSON writer when possible. If manual editing is
required, preserve JSON syntax and do not echo secrets into chat.

Recommended `bot.json` shape:

```json
{
  "botToken": "<telegram-bot-token>",
  "allowedUserId": 123456789,
  "allowedChats": [
    {
      "chatId": -1001234567890,
      "topics": "all"
    }
  ],
  "defaultCwd": "/absolute/workspace/path",
  "defaultAgent": "codex",
  "agents": {
    "codex": {
      "label": "Codex",
      "command": "codex-acp",
      "args": []
    }
  },
  "pollTimeoutSeconds": 25,
  "flushIntervalMs": 1200,
  "liveEditIntervalMs": 2500
}
```

## Install And Verify

Install dependencies and build:

```bash
npm ci
npm test
npm run build
node dist/cli.js --help
```

Verify agent command on the host:

```bash
command -v <agent-command>
```

Run a minimal ACP probe after config exists:

```bash
node dist/cli.js probe acp
```

Start foreground bridge for a smoke test:

```bash
node dist/cli.js serve
```

Stop the foreground process after confirming the bot responds.

## Autostart

Ask before configuring autostart.

### systemd user service

Use only when `systemctl --user` works.

Unit path:

```bash
~/.config/systemd/user/ai-telegram-bridge.service
```

Template:

```ini
[Unit]
Description=AI Telegram Bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=<absolute path to this repository>
ExecStart=<absolute path to this repository>/node_modules/.bin/tsx src/cli.ts serve
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=300
StartLimitBurst=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Commands:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-telegram-bridge.service
systemctl --user status ai-telegram-bridge.service --no-pager
journalctl --user -u ai-telegram-bridge.service -f
```

## Validation Checklist

Before saying install is complete:

- `bot.json` exists and is ignored by git.
- `git status --short` does not show secrets staged or tracked.
- Node.js 22+ and npm were verified on the host.
- Agent command was verified on the host.
- Bridge process starts without config errors.
- Telegram bot responds to `/help` or `/status`.
- Logs are visible through the chosen runtime.
- Update command was given to the user.

Useful checks:

```bash
git status --short
rg -n "AAG|botToken|allowedUserId|AI_TELEGRAM_BOT_TOKEN" . --glob '!node_modules/**' --glob '!dist/**' --glob '!bot.json'
```

## Update Commands

With systemd:

```bash
git pull
npm ci
npm run build
systemctl --user restart ai-telegram-bridge.service
```

If no systemd service is configured, restart the foreground or process-manager
command the user chose.

## Final Report Template

Finish with:

- config path used
- agent id and command configured
- runtime status
- autostart status
- log command
- update command

Do not include the full Telegram bot token in the final report.
