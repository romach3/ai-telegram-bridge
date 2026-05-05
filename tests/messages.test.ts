import { describe, expect, it, vi } from 'vitest';
import {
  renderTelegramMarkdownChunks,
  sendTelegramChunks,
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
});
