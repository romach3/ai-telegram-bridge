# systemd Notes For Agents

The bridge is intended to run as a long-lived user service during local use.

Example unit:

```ini
[Unit]
Description=AI Telegram Bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/ai-telegram-bridge
ExecStart=/path/to/ai-telegram-bridge/node_modules/.bin/tsx src/cli.ts serve
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=300
StartLimitBurst=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Operational commands:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-telegram-bridge.service
systemctl --user status ai-telegram-bridge.service --no-pager
journalctl --user -u ai-telegram-bridge.service -f
```

Restart policy:

- Do not restart after docs-only changes.
- Do not restart after code changes unless the user requested live validation.
- If restarting during development, confirm the service becomes `active` and
  check that the main process still uses the intended local package path.

Current local service convention in this workspace uses package-local
dependencies:

```text
node_modules/.bin/tsx src/cli.ts serve
```

That keeps the bridge independent from global `tsx` installs.
