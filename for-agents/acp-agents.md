# Agent Notes For Agents

The bridge supports ACP agents through the shared `AcpAgent`
interface in `src/types/acp.ts`. The built-in implementation is stdio ACP.

## ACP Agent Config

Config:

```json
{
  "defaultAgent": "codex",
  "agents": {
    "codex": {
      "label": "Codex",
      "command": "codex-acp",
      "args": []
    }
  }
}
```

Relevant files:

- `src/acp/stdio-agent.ts` creates stdio ACP agent instances from config.
- `src/acp/stdio-agent.ts` maps bridge operations to ACP methods:
  `initialize`, `session/new`, `session/load`, `session/prompt`,
  `session/cancel`.
- `src/acp/json-rpc-client.ts` starts the process and sends/receives
  newline-delimited JSON-RPC.
- `src/acp/events.ts` extracts normalized values from ACP update
  payloads.

`cwd` in agent config controls the agent process working directory.
Session cwd is still sent separately to ACP `session/new` and `session/load`.

## Adding Another ACP Command

If another tool already speaks ACP over stdio, do not add a new agent class.
Add another ACP agent config entry:

```json
{
  "defaultAgent": "codex",
  "agents": {
    "codex": {
      "label": "Codex",
      "command": "codex-acp"
    },
    "other": {
      "label": "Other ACP",
      "command": "other-acp",
      "args": ["--acp"]
    }
  }
}
```

Telegram command notes:

- `/new` shows agent buttons when more than one agent is configured.
- `/agents` is a hidden recovery command that lists configured agents.

## Agent Scope

The bridge intentionally supports one agent transport: ACP over stdio. Codex,
Gemini, Claude, and similar local coding agents should be configured as
different agent entries, not as provider-specific bridge code.

Do not add non-ACP agent layers unless the project explicitly expands beyond
ACP. If that happens, revisit the architecture first instead of adding an
ad-hoc adapter.
