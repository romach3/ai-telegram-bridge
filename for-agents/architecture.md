# Architecture Notes For Agents

The bridge has three real runtime surfaces:

- Telegram client surface: receiving messages, sending/editing messages,
  formatting output, and routing Telegram bot events.
- ACP backend surface: starting a backend process, speaking ACP JSON-RPC, and
  interpreting ACP update events.
- Bridge runtime surface: connecting Telegram updates to backend prompts,
  tracking one active turn, persisting sessions/permissions, and rendering live
  progress.

Keep those surfaces separate. Avoid adding intermediate "service/action/getter"
layers unless they protect a real boundary.

## Entry Flow

1. `src/cli.ts` receives `serve`.
2. `src/config.ts` loads env vars and optional `bot.json`.
3. `src/runtime.ts` constructs `BridgeRuntime`.
4. `BridgeRuntime.start()` initializes the default backend, restores Telegram
   registers bot commands, then lets `grammy Bot` own long polling.
5. Telegram text commands are handled inside `runtime.ts`.
6. Regular Telegram text is sent to the active backend as `session/prompt`.
7. ACP updates are parsed by `backend/acp/events.ts` and rendered by runtime.

`probe acp` also lives in `src/cli.ts`; it uses config plus backend registry to
run a minimal ACP session without Telegram.

## File Ownership

- `src/runtime.ts`
  - Owns chat command handling: `/new`, `/resume`, `/compact`, `/load`,
    `/cancel`, `/status`, `/sessions`, `/backends`, `/help`.
  - Owns active-turn flags, message buffers, live technical status, permission
    request rendering, and callback handling.
  - Should not contain raw Telegram HTTP calls or child-process JSON-RPC.

- `src/state.ts`
  - Owns `data/sessions.json` and `data/pending-permissions.json`.
  - Contains bridge-specific persistence, not generic file utilities.

- `src/config.ts`
  - Owns env var names, default backend config, and `bot.json` loading.
  - Do not duplicate config defaults in runtime or docs examples.

- `src/telegram/bot-api.ts`
  - Owns the `grammy Bot` instance, long polling, Telegram command callbacks,
    and outgoing Bot API calls.
  - Converts Telegram middleware context into bridge DTOs before calling
    runtime handlers.

- `src/telegram/markdown.ts`, `messages.ts`
  - Telegram-safe MarkdownV2 rendering and message splitting/editing. Put
    Telegram parse mode decisions here, not in backend code.
  - `markdown.ts` is an adapter over `telegramify-markdown` plus small helpers
    for escaping raw runtime values. Do not reintroduce a custom Markdown parser
    unless the package cannot express a required Telegram behavior.

- `src/backend/registry.ts`
  - Owns backend type dispatch. Add new backend types here.

- `src/backend/acp/*`
  - Built-in stdio ACP backend, JSON-RPC transport, ACP event parsing, and ACP
    event logging.

- `src/types/*`
  - Shared structural types. Prefer adding types here over passing `any` or
    broad `object` values between layers.

## Event Rendering Model

ACP updates arrive as JSON-RPC notifications. Runtime splits them into:

- agent final text chunks
- agent thought/status chunks
- tool call summaries and tool output
- permission requests
- session ids and usage/no-op updates

Transient thought/tool/log content is rendered as a technical live message.
Once final answer text is ready, final answer rendering replaces the transient
flow. Preserve this behavior when changing message formatting; otherwise the bot
will either spam Telegram or hide the actual answer.

## Persistence Model

Runtime files live under ignored `data/`:

- `sessions.json`
- `pending-permissions.json`
- `acp-events.jsonl`

These are runtime state, not durable application data. Keep writes atomic for
JSON files via `utils/files.ts`. Do not commit concrete runtime state.

## Telegram Runtime

Telegram transport concerns belong to `grammy Bot`. Runtime receives small
bridge DTOs from `src/types/telegram.ts` and should not depend on raw Telegram
update shapes. Keep bridge-specific ACP turn handling, permission correlation,
and technical status rendering explicit in runtime code.
