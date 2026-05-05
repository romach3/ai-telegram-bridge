# ai-telegram-bridge

[![CI](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22%2B-339933)
![ACP](https://img.shields.io/badge/backend-ACP-4b5563)
![Telegram](https://img.shields.io/badge/ui-Telegram-2AABEE)

[English](README.md) | [Русская версия](README.ru.md)

Запускайте coding agent прямо из Telegram.

`ai-telegram-bridge` превращает Telegram в удалённый интерфейс для вашего
coding agent. Можно отправлять задачи с телефона, смотреть живое сообщение с
прогрессом, отвечать на вопросы агента и нажимать approve/deny для tool
permissions. Агент продолжает работать в вашем workspace, а Telegram становится
панелью управления.

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

- `/new` создаёт новую ACP-сессию. Если настроено несколько backends, сначала
  показывает кнопки выбора backend.
- `/resume` показывает кнопки для последних пяти сессий, которые можно
  восстановить.
- `/compact` отправляет `/compact` в активную ACP-сессию.
- `/status` показывает состояние bridge/session.
- `/cancel` отменяет текущий ход.
- `/help` показывает команды.

Любой обычный текст отправляется в активную ACP-сессию как `session/prompt`.
Первый обычный prompt в новой сессии становится её человеческим заголовком в
`/resume`. Debug-команды вроде `/load`, `/sessions` и `/backends` остаются для
recovery, но намеренно скрыты из Telegram command menu.

## Заметки

Bridge общается с ACP backends через newline-delimited JSON-RPC по stdio. Идея
похожа на работу ACP-агента в редакторе вроде Zed, только UI здесь Telegram.

## Безопасность

Считайте bridge удалённым доступом к вашему локальному coding agent. Используйте
свой Telegram bot token, не передавайте его другим и запускайте один bridge
instance на один bot token. Если bridge нужен другому пользователю, создайте
для него отдельного Telegram-бота. Управление поддерживается только в private
chat с настроенным Telegram user; групповые чаты намеренно не поддерживаются.
Подробные security notes лежат в `for-agents/security.md`.

## Для Разработчиков

Это AI-first проект: установку и повседневное сопровождение предполагается
делегировать coding agent.

`AGENTS.md` и `for-agents/` написаны для таких агентов и maintainers. Там
описаны runtime boundaries, ownership файлов, extension points, команды
проверки и правила изменений. Если меняется пользовательская документация,
синхронно обновляйте `README.md` и `README.ru.md`.
