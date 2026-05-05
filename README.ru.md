# ai-telegram-bridge

[English](README.md) | [Русская версия](README.ru.md)

Управляйте ACP-агентом из Telegram.

`ai-telegram-bridge` соединяет Telegram-бота с ACP backend. Вы пишете сообщение
в Telegram, bridge отправляет его в активную ACP-сессию, а ответ возвращается в
тот же чат. Запросы на разрешение превращаются в Telegram-кнопки, прогресс
показывается редактируемым статусом, а `/cancel` останавливает текущий ход.

Если на машине есть `codex-acp`, Codex ACP можно использовать сразу. Но проект
не привязан к Codex: можно настроить любой stdio ACP backend.

## AI-Установка

Самый простой путь — попросить coding agent установить bridge по готовому
runbook:

```text
for-agents/install.md
```

Runbook объясняет агенту, как спросить credentials, выбрать Node или Docker,
проверить ACP backend command, записать локальный config и при желании настроить
автозапуск. Это интерактивный сценарий, не shell script.

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

## Ручная Настройка

Нужны Telegram bot token, ваш numeric Telegram user id, путь к workspace и ACP
backend command.

Можно настроить bridge через environment variables:

```bash
export AI_TELEGRAM_BOT_TOKEN="..."
export AI_TELEGRAM_ALLOWED_USER_ID="123456"
export AI_TELEGRAM_DEFAULT_CWD="/path/to/workspace"
export AI_TELEGRAM_ACP_COMMAND="codex-acp"
export AI_TELEGRAM_DEFAULT_BACKEND="codex"
```

Или скопировать локальный config template:

```bash
cp bot.example.json bot.json
```

`bot.json` игнорируется git. Храните реальные токены там или в env vars, но не
в tracked files.

Пример backend config:

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

## Запуск Через Node

```bash
npm install
npm run dev -- serve
```

Production-style запуск:

```bash
npm run build
npm start -- serve
```

## Запуск Через Docker

Docker удобен, если не хочется ставить Node на host:

```bash
cp .env.example .env
cp bot.example.json bot.json
docker compose up -d --build
```

После обновления репозитория:

```bash
git pull
docker compose up -d --build
```

Runtime state хранится в Docker volume `bridge-data`. Compose монтирует
`bot.json` read-only и монтирует `AI_TELEGRAM_WORKSPACE` в `/workspace`.

Важный момент: Docker image содержит сам bridge, но не все возможные ACP
backends. Если backend command — `codex-acp`, `gemini-acp` или что-то своё,
эта команда тоже должна существовать внутри контейнера. Для этого нужен custom
image, mount binary или запуск через Node на host.

## Telegram Команды

- `/new [backend] [cwd]` создаёт новую ACP-сессию.
- `/resume` показывает кнопки для последних пяти локальных сессий.
- `/compact` отправляет `/compact` в активную ACP-сессию.
- `/load <sessionId> [backend] [cwd]` загружает существующую сессию.
- `/status` показывает состояние bridge/session.
- `/sessions` выводит локально известные сессии.
- `/backends` выводит настроенные ACP backends.
- `/cancel` отменяет текущий ход.
- `/help` показывает команды.

Любой обычный текст отправляется в активную ACP-сессию как `session/prompt`.

## Заметки

Bridge общается с ACP backends через newline-delimited JSON-RPC по stdio. Идея
похожа на работу ACP-агента в редакторе вроде Zed, только UI здесь Telegram.

## Для Разработчиков

`AGENTS.md` и `for-agents/` написаны для coding agents и maintainers. Там
описаны runtime boundaries, ownership файлов, extension points и правила
изменений.
