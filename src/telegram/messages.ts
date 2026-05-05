import { splitTelegramText } from '../utils/chunks';
import { log } from '../utils/logger';
import type { TelegramBotApi } from './bot-api';
import { renderTelegramMarkdown } from './markdown';

export function renderTelegramMarkdownChunks(markdown: string): string[] {
  return splitTelegramText(renderTelegramMarkdown(markdown));
}

export async function sendTelegramChunks(
  bot: TelegramBotApi,
  chatId: number,
  markdown: string,
): Promise<void> {
  const chunks = renderTelegramMarkdownChunks(markdown);
  for (const [index, chunk] of chunks.entries()) {
    const messageId = await bot.sendMessage({ chatId, text: chunk });
    log(
      `sent telegram chunk ${index + 1}/${chunks.length} messageId=${messageId ?? 'unknown'} chars=${chunk.length}`,
    );
  }
}
