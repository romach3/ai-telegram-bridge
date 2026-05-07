import { describe, expect, it, vi } from 'vitest';
import {
  renderTelegramMarkdownChunks,
  renderTelegramPlainChunks,
  sendTelegramChunks,
  sendTelegramPlainChunks,
} from '../src/telegram/messages';

describe('Telegram message helpers', () => {
  it('renders markdown into chunks', () => {
    expect(
      renderTelegramMarkdownChunks('# Title').map((chunk) => chunk.trim()),
    ).toEqual(['*Title*']);
  });

  it('sends every rendered chunk', async () => {
    const bot = {
      sendMessage: vi.fn().mockResolvedValue(10),
    };

    await sendTelegramChunks(
      bot,
      123,
      ['one', 'two', 'three'].join('\n\n'.repeat(2000)),
    );

    expect(bot.sendMessage).toHaveBeenCalled();
    for (const call of bot.sendMessage.mock.calls) {
      expect(call[0]).toMatchObject({ chatId: 123 });
      expect(call[0].text.length).toBeLessThanOrEqual(3900);
    }
  });

  it('keeps Telegram topic id on chunked sends', async () => {
    const bot = {
      sendMessage: vi.fn().mockResolvedValue(10),
    };

    await sendTelegramChunks(bot, -100, 'topic answer', 77);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100,
        messageThreadId: 77,
        text: expect.stringContaining('topic answer'),
      }),
    );
  });

  it('renders and sends plain chunks without MarkdownV2 parse mode', async () => {
    const text = 'plain text with dots. underscores_and [brackets].';
    expect(renderTelegramPlainChunks(text)).toEqual([text]);

    const bot = {
      sendMessage: vi.fn().mockResolvedValue(11),
    };

    await sendTelegramPlainChunks(bot, 123, text, 5);

    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId: 123,
      messageThreadId: 5,
      text,
      parseMode: 'none',
    });
  });
});
