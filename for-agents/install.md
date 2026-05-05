# Interactive Install Runbook For Agents

You are installing `ai-telegram-bridge` for a human operator. This file is a
prompt-runbook, not a shell script. Follow it interactively and adapt commands
to the host OS.

## Goal

Install and start `ai-telegram-bridge` so one allowed Telegram user can control
one configured ACP backend through a Telegram bot.

End state:

- dependencies are installed through either Node or Docker
- local config exists without committing secrets
- the Telegram bot token and allowed user id are configured
- at least one ACP backend command is configured and verified
- the bridge can start
- optional autostart/autorestart is configured only after explicit approval
- the user knows how to update, inspect logs, and stop the service

## Non-Negotiable Safety Rules

- Do not commit secrets.
- Do not print the full Telegram bot token back to the user after receiving it.
- Do not write secrets to tracked files.
- Do not overwrite an existing `bot.json`, `.env`, systemd unit, or compose
  deployment without showing the current path and asking first.
- Do not install Node, Docker, system packages, global npm packages, or service
  units without explicit confirmation.
- Do not assume `codex-acp`, Gemini ACP, Claude, or any backend command exists.
  Verify the selected backend command with the user's chosen install mode.
- Do not start a long-running service until config and backend command checks
  have passed.

## Initial Questions

Ask these questions before making changes:

1. Install mode:
   - Node on host
   - Docker Compose
2. Backend command:
   - default `codex-acp`
   - another ACP command
3. Workspace path:
   - path the backend should use as its default working directory
4. Autostart:
   - no autostart
   - systemd user service
   - Docker Compose restart policy
5. Credentials:
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
command -v docker || true
docker --version || true
docker compose version || true
command -v systemctl || true
systemctl --user status >/dev/null 2>&1; echo $?
```

Interpretation:

- Node mode needs Node 22+ and npm.
- Docker mode needs Docker Engine and Docker Compose v2.
- systemd autostart needs a working `systemctl --user`.

If required tooling is missing, ask before installing it. Use the host's package
manager. Do not guess the package manager when uncertain; inspect the OS first.

## Config Files

Package directory:

```bash
.
```

Ignored local config files:

- `bot.json`
- `.env`
- `data/*`

If `bot.json` does not exist:

```bash
cp bot.example.json bot.json
```

If Docker mode and `.env` does not exist:

```bash
cp .env.example .env
```

Edit config with a real JSON or dotenv writer when possible. If manual editing
is required, preserve JSON syntax and do not echo secrets into chat.

Recommended `bot.json` shape:

```json
{
  "botToken": "<telegram-bot-token>",
  "allowedUserId": 123456789,
  "defaultCwd": "/absolute/workspace/path",
  "defaultBackend": "codex",
  "backends": {
    "codex": {
      "type": "stdio-acp",
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

For Docker mode, `.env` should contain:

```dotenv
AI_TELEGRAM_BOT_TOKEN=<telegram-bot-token>
AI_TELEGRAM_ALLOWED_USER_ID=123456789
AI_TELEGRAM_DEFAULT_CWD=/workspace
AI_TELEGRAM_ACP_COMMAND=codex-acp
AI_TELEGRAM_DEFAULT_BACKEND=codex
AI_TELEGRAM_WORKSPACE=/absolute/host/workspace/path
```

`bot.json` can still define richer backend config. The compose file mounts it
read-only into the container.

## Node Install Path

Use this when the user chooses host Node:

```bash
npm ci
npm test
npm run build
node dist/cli.js --help
```

Verify backend command on the host:

```bash
command -v <backend-command>
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

## Docker Install Path

Use this when the user chooses Docker Compose:

```bash
docker compose config
docker compose up -d --build
docker compose logs -f ai-telegram-bridge
```

If `docker compose config` fails because required env vars are missing, finish
`.env` first.

Verify backend command inside the container. For the default compose image,
only Node bridge runtime is guaranteed. If `<backend-command>` is not available
inside the container, stop and present options:

- build a custom image that installs the backend command
- mount a backend binary into the container
- use Node host mode instead
- configure a backend command that exists in the container

Do not pretend a host CLI is available inside Docker.

## Autostart Options

Ask before configuring autostart.

### systemd user service for Node mode

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

### Docker Compose autostart

The tracked compose service uses:

```yaml
restart: unless-stopped
```

Start it with:

```bash
docker compose up -d --build
```

The host still needs Docker itself to start at boot. If Docker is not enabled,
ask before enabling it with the host's service manager.

## Validation Checklist

Before saying install is complete:

- `bot.json` or `.env` exists and is ignored by git
- `git status --short` does not show secrets staged or tracked
- backend command was verified in the selected runtime environment
- bridge process starts without config errors
- Telegram bot responds to `/help` or `/status`
- logs are visible through the chosen runtime
- update command was given to the user

Useful checks:

```bash
git status --short
rg -n "AAG|botToken|allowedUserId|AI_TELEGRAM_BOT_TOKEN" . --glob '!node_modules/**' --glob '!dist/**' --glob '!bot.json' --glob '!.env'
```

## Update Commands

Node mode:

```bash
git pull
npm ci
npm run build
systemctl --user restart ai-telegram-bridge.service
```

If no systemd service is configured, restart the foreground or process-manager
command the user chose.

Docker mode:

```bash
git pull
docker compose up -d --build
```

## Final Report Template

Finish with:

- install mode used
- config path used
- backend id and command configured
- runtime status
- autostart status
- log command
- update command

Do not include the full Telegram bot token in the final report.
