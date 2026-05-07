# Architecture Notes For Agents

The bridge has three real runtime surfaces:

- Telegram client surface: receiving messages, sending/editing messages,
  formatting output, and routing Telegram bot events.
- ACP agent surface: starting an agent process, speaking ACP JSON-RPC, and
  interpreting ACP update events.
- Bridge runtime surface: connecting Telegram updates to agent prompts,
  tracking active turns by conversation scope, persisting sessions/permissions,
  and rendering live progress.

Keep those surfaces separate. Avoid adding intermediate "service/action/getter"
layers unless they protect a real boundary.

## Entry Flow

1. `src/cli.ts` receives `serve`.
2. `src/config.ts` loads env vars and optional `bot.json`.
3. `src/runtime.ts` re-exports the runtime facade; `src/runtime/bridge-runtime.ts`
   constructs `BridgeRuntime`.
4. `BridgeRuntime.start()` initializes the default agent, registers Telegram
   bot commands, then lets `grammy Bot` own long polling.
5. Telegram text commands are handled inside
   `src/runtime/handlers/telegram-messages.ts`.
6. Regular Telegram text is sent to the active agent as `session/prompt`.
   Private chat uses one scope; each configured group topic uses its own scope.
7. ACP updates are parsed by `src/acp/events.ts` and rendered by runtime.

`probe acp` also lives in `src/cli.ts`; it uses config plus agent setup to
run a minimal ACP session without Telegram.

## File Ownership

- `src/runtime.ts`
  - Public compatibility facade for runtime exports.
  - Keep it thin; do not put behavior here.

- `src/runtime/bridge-runtime.ts`
  - Owns composition and startup wiring: bot, ACP agents, runtime services,
    Telegram listeners, ACP update listeners, command registration, webhook
    diagnostic, and ACP event logging.
  - Keep this file thin. It should delegate Telegram messages, Telegram
    callbacks, ACP updates, and prompt execution to focused runtime modules.
  - Should not contain raw Telegram HTTP calls or child-process JSON-RPC.

- `src/runtime/handlers/telegram-messages.ts`
  - Owns Telegram text command routing: `/new`, `/resume`, `/compact`,
    `/cancel`, `/status`, `/agents`, `/help`, unknown command handling, and
    handing regular prompts to `PromptRunner`.

- `src/runtime/handlers/telegram-callbacks.ts`
  - Owns inline callback routing for new-session and resume-session buttons.
  - Delegates permission decisions to `permission-callbacks.ts`.

- `src/runtime/handlers/permission-callbacks.ts`
  - Owns approval/denial callback decisions for pending ACP permission
    requests, including expired-request safe denial.

- `src/runtime/handlers/acp-updates.ts`
  - Owns ACP `session/update` and `session/request_permission` notifications,
    including text chunk classification, tool status/log rendering, and
    permission request message creation.

- `src/runtime/services/agent-service.ts`
  - Owns ACP agent lookup, initialization, session creation, and session loading.

- `src/runtime/services/session-service.ts`
  - Owns bridge session creation, session normalization, prompt label setup,
    and active `TurnContext` reset/prepare mechanics.

- `src/runtime/services/prompt-runner.ts`
  - Owns sending user prompts to ACP, final answer delivery, stop-reason
    handling, and success/failure session status updates.

- `src/runtime/services/permission-wait-service.ts`
  - Owns stale `waiting_permission` recovery and pending-permission lookup.

- `src/runtime/rendering/live-turn.ts`
  - Owns typing refresh, transient technical status messages, replacing
    technical status with the final answer, and Markdown-to-plain fallback for
    final answer delivery.

- `src/runtime/state/turn-context-registry.ts`
  - Owns per-scope `TurnContext` instances and ACP session-to-scope routing.
  - Keep ambiguous update fallback here so group topics and parallel turns stay
    consistent.

- `src/runtime/policy/authorization.ts`, `permissions.ts`, `sessions.ts`,
  `acp-routing.ts`
  - Runtime-owned helper modules.
  - Keep policy helpers here when they are specific to bridge runtime behavior
    and not generic enough for `utils/`.

- `src/runtime/rendering/text.ts`
  - Runtime-owned technical text cleanup and extraction helpers.

- `src/runtime/types.ts`
  - Runtime-local structural types such as `ConversationScope`, `TurnContext`,
    and `ResumeMenu`.

- `src/state.ts`
  - Owns `data/sessions.json` and `data/pending-permissions.json`.
  - Contains bridge-specific persistence, not generic file utilities.

- `src/config.ts`
  - Owns env var names, default agent config, and `bot.json` loading.
  - Do not duplicate config defaults in runtime or docs examples.

- `src/telegram/bot-api.ts`
  - Owns the `grammy Bot` instance, long polling, Telegram command callbacks,
    and outgoing Bot API calls.
  - Converts Telegram middleware context into bridge DTOs before calling
    runtime handlers.

- `src/telegram/markdown.ts`, `messages.ts`
  - Telegram-safe MarkdownV2 rendering and message splitting/editing. Put
    Telegram parse mode decisions here, not in agent code.
  - `markdown.ts` is an adapter over `telegramify-markdown` plus small helpers
    for escaping raw runtime values. Do not reintroduce a handwritten Markdown parser
    unless the package cannot express a required Telegram behavior.

- `src/acp/stdio-agent.ts`
  - Owns stdio ACP agent setup.

- `src/acp/*`
  - ACP stdio agent, JSON-RPC transport, ACP event parsing, and ACP
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

Transient thought/tool/log content is rendered by
`src/runtime/rendering/live-turn.ts` as a technical live message. Once final
answer text is ready, final answer rendering replaces the transient flow.
Preserve this behavior when changing message formatting; otherwise the bot will
either spam Telegram or hide the actual answer.

## Persistence Model

Runtime files live under ignored `data/`:

- `sessions.json`
- `pending-permissions.json`
- `acp-events.jsonl`

These are runtime state, not durable application data. Keep writes atomic for
JSON files via `utils/files.ts`. Do not commit concrete runtime state.

`sessions.json` uses `scopeId` to map a Telegram surface to an ACP session:

- `chat:<chatId>` for private chat;
- `chat:<chatId>:topic:<message_thread_id>` for group forum topics.

`/resume` lists recent valid sessions across all scopes. Selecting a session
makes it active in the current scope, unless that session is already running in
another scope.

## Telegram Runtime

Telegram transport concerns belong to `grammy Bot`. Runtime receives small
bridge DTOs from `src/types/telegram.ts` and should not depend on raw Telegram
update shapes. Keep bridge-specific ACP turn handling, permission correlation,
and technical status rendering explicit in runtime code.

When sending messages to a group topic, preserve `messageThreadId` on
`sendMessage` and `sendChatAction`. Permission messages and live status messages
must return to the same topic that started the turn.
