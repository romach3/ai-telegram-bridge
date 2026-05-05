# Backend Notes For Agents

The bridge supports backend implementations through the shared `AcpBackend`
interface in `src/types/backend.ts`. The built-in implementation is stdio ACP.

## Built-In Backend

Config:

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

Relevant files:

- `src/backend/registry.ts` creates backend instances from config.
- `src/backend/acp/stdio-backend.ts` maps bridge operations to ACP methods:
  `initialize`, `session/new`, `session/load`, `session/prompt`,
  `session/cancel`.
- `src/backend/acp/json-rpc-client.ts` starts the process and sends/receives
  newline-delimited JSON-RPC.
- `src/backend/acp/events.ts` extracts normalized values from ACP update
  payloads.

`cwd` in backend config controls the backend process working directory.
Session cwd is still sent separately to ACP `session/new` and `session/load`.

## Adding Another ACP Command

If another tool already speaks ACP over stdio, do not add a new backend class.
Add another `stdio-acp` config entry:

```json
{
  "defaultBackend": "codex",
  "backends": {
    "codex": {
      "type": "stdio-acp",
      "label": "Codex",
      "command": "codex-acp"
    },
    "other": {
      "type": "stdio-acp",
      "label": "Other ACP",
      "command": "other-acp",
      "args": ["--acp"]
    }
  }
}
```

Telegram command examples:

- `/new other /path/to/workspace`
- `/load <sessionId> other /path/to/workspace`
- `/backends`

## Adding A Custom Backend Type

Use `src/backend/custom/` for custom implementations. Register the new type in
`src/backend/registry.ts`.

Implementation rules:

- Implement `AcpBackend`.
- Emit `message` events with ACP-like JSON-RPC notification payloads if you want
  existing runtime parsing to work.
- Support `initialize`, `createSession`, `loadSession`, `prompt`, `cancel`,
  `respond`, `start`, and `stop`.
- Keep provider-specific auth, request formats, retry behavior, and transport
  details inside the custom backend.
- Do not add provider-specific branches to `runtime.ts` unless Telegram UX must
  change for every backend.

If the custom backend does not produce standard ACP `session/update` events,
add a parser beside that backend and adapt `runtime.ts` deliberately. Do not
silently overload `backend/acp/events.ts` with non-ACP shapes.
