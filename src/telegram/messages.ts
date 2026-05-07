import { splitTelegramText } from '../utils/chunks';
import { log } from '../utils/logger';
import type { TelegramBotApi } from './bot-api';
import { renderTelegramMarkdown } from './markdown';

export function renderTelegramMarkdownChunks(markdown: string): string[] {
  return splitTelegramText(renderTelegramMarkdown(markdown));
}

export function renderTelegramPlainChunks(text: string): string[] {
  return splitTelegramText(text);
}

export async function sendTelegramChunks(
  bot: TelegramBotApi,
  chatId: number,
  markdown: string,
  messageThreadId?: number,
): Promise<void> {
  const chunks = renderTelegramMarkdownChunks(markdown);
  for (const [index, chunk] of chunks.entries()) {
    const messageId = await bot.sendMessage({
      chatId,
      messageThreadId,
      text: chunk,
    });
    log(
      `sent telegram chunk ${index + 1}/${chunks.length} messageId=${messageId ?? 'unknown'} chars=${chunk.length}`,
    );
  }
}

export async function sendTelegramPlainChunks(
  bot: TelegramBotApi,
  chatId: number,
  text: string,
  messageThreadId?: number,
): Promise<void> {
  const chunks = renderTelegramPlainChunks(text);
  for (const [index, chunk] of chunks.entries()) {
    const messageId = await bot.sendMessage({
      chatId,
      messageThreadId,
      text: chunk,
      parseMode: 'none',
    });
    log(
      `sent telegram plain chunk ${index + 1}/${chunks.length} messageId=${messageId ?? 'unknown'} chars=${chunk.length}`,
    );
  }
}
