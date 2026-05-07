# ai-telegram-bridge

[![CI](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/romach3/ai-telegram-bridge/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22%2B-339933)
![ACP](https://img.shields.io/badge/agent-ACP-4b5563)
![Telegram](https://img.shields.io/badge/ui-Telegram-2AABEE)

[English](README.md) | [Русская версия](README.ru.md)

Запускайте coding agent прямо из Telegram.

`ai-telegram-bridge` превращает Telegram в удалённый интерфейс для вашего
coding agent. Можно отправлять задачи с телефона, смотреть живое сообщение с
прогрессом, отвечать на вопросы агента и нажимать approve/deny для tool
permissions. Агент продолжает работать в вашем workspace, а Telegram становится
панелью управления.

Если на машине есть `codex-acp`, Codex ACP можно использовать сразу. Но проект
не привязан к Codex: можно настроить любой stdio ACP agent.

## AI-Установка

Самый простой путь — попросить coding agent установить bridge по готовому
runbook:

```text
for-agents/install.md
```

Runbook объясняет агенту, как проверить или установить Node.js, спросить
credentials, проверить ACP agent command, записать локальный config и при
желании настроить автозапуск. Это интерактивный сценарий, не shell script.

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
agent command.

Можно настроить bridge через environment variables:

```bash
export AI_TELEGRAM_BOT_TOKEN="..."
export AI_TELEGRAM_ALLOWED_USER_ID="123456"
export AI_TELEGRAM_DEFAULT_CWD="/path/to/workspace"
export AI_TELEGRAM_ACP_COMMAND="codex-acp"
export AI_TELEGRAM_DEFAULT_AGENT="codex"
```

Или скопировать локальный config template:

```bash
cp bot.example.json bot.json
```

`bot.json` игнорируется git. Храните реальные токены там или в env vars, но не
в tracked files.

Пример agent config:

```json
{
  "allowedChats": [
    {
      "chatId": -1001234567890,
      "topics": "all"
    }
  ],
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

`allowedChats` опционален. Без него bridge работает только в private chat с
`allowedUserId`. Если группа добавлена в `allowedChats`, можно использовать
Telegram forum topics: каждый topic становится отдельной рабочей областью, а
задачи в разных topics могут выполняться одновременно.

## Запуск

```bash
npm install
npm run dev -- serve
```

Production-style запуск:

```bash
npm run build
npm start -- serve
```

## Telegram Команды

- `/new` создаёт новую ACP-сессию для текущего private chat или group topic.
  Если настроено несколько agents, сначала показывает кнопки выбора agent.
- `/resume` показывает кнопки для всех resumable-сессий из всех scopes; выбор
  сессии делает её активной в текущем chat/topic.
- `/compact` отправляет `/compact` в активную ACP-сессию.
- `/status` показывает состояние bridge/session.
- `/cancel` отменяет текущий ход.
- `/help` показывает команды.

Любой обычный текст отправляется в активную ACP-сессию как `session/prompt`.
Первый обычный prompt в новой сессии становится её человеческим заголовком в
`/resume`. `/agents` — скрытая debug-команда; она намеренно не попадает в
Telegram command menu.

В настроенной Telegram-группе сообщения должны отправляться внутри forum
topics. Новый topic автоматически создаёт новую session на первом обычном
prompt. У каждого topic свои live status, permissions, cancellation и active
turn.

## Заметки

Bridge общается с ACP agents через newline-delimited JSON-RPC по stdio. Идея
похожа на работу ACP-агента в редакторе вроде Zed, только UI здесь Telegram.

## Безопасность

Считайте bridge удалённым доступом к вашему локальному coding agent. Используйте
свой Telegram bot token, не передавайте его другим и запускайте один bridge
instance на один bot token. Если bridge нужен другому пользователю, создайте
для него отдельного Telegram-бота. По умолчанию управление поддерживается в
private chat с настроенным Telegram user. Group topics можно включить только
для явных `allowedChats`, и команды всё равно принимаются только от
`allowedUserId`. Подробные security notes лежат в `for-agents/security.md`.

## Для Разработчиков

Это AI-first проект: установку и повседневное сопровождение предполагается
делегировать coding agent.

`AGENTS.md` и `for-agents/` написаны для таких агентов и maintainers. Там
описаны runtime boundaries, ownership файлов, extension points, команды
проверки и правила изменений. Если меняется пользовательская документация,
синхронно обновляйте `README.md` и `README.ru.md`.
