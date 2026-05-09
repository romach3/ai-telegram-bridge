import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTurnRenderer } from '../src/runtime/rendering/live-turn';
import type { TurnContext } from '../src/runtime/types';

describe('LiveTurnRenderer final answer delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for Telegram retry_after before replacing a technical message', async () => {
    const bot = fakeBot();
    bot.editMessageText
      .mockRejectedValueOnce(new Error('429: Too Many Requests: retry after 0'))
      .mockResolvedValueOnce(undefined);
    const context = turnContext({
      buffer: 'final answer',
      toolStatusMessageId: 10,
    });

    const promise = new LiveTurnRenderer(bot).sendFinalAnswer(context);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(bot.editMessageText).toHaveBeenCalledTimes(2);
    expect(context.toolStatusMessageId).toBeUndefined();
  });

  it('retries plain fallback after Telegram retry_after', async () => {
    const bot = fakeBot();
    bot.sendMessage
      .mockRejectedValueOnce(new Error("400: can't parse entities"))
      .mockRejectedValueOnce(new Error('429: Too Many Requests: retry after 0'))
      .mockResolvedValueOnce(12);
    const context = turnContext({ buffer: 'plain fallback answer.' });

    const promise = new LiveTurnRenderer(bot).sendFinalAnswer(context);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(bot.sendMessage).toHaveBeenCalledTimes(3);
    expect(bot.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parseMode: 'none',
        text: 'plain fallback answer.',
      }),
    );
  });
});

function fakeBot() {
  return {
    sendMessage: vi.fn().mockResolvedValue(1),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn(),
    answerCallbackQuery: vi.fn(),
    sendChatAction: vi.fn(),
  };
}

function turnContext(input: Partial<TurnContext> = {}): TurnContext {
  return {
    chatId: 42,
    scopeId: 'chat:42',
    activePrompt: false,
    buffer: '',
    pendingPromptText: '',
    pendingUserText: '',
    collectingCurrentPrompt: false,
    preToolAgentBuffer: '',
    currentAgentStatusSegment: '',
    sawToolEvent: false,
    activeToolCallIds: new Set(),
    toolStatusText: '',
    technicalThoughtText: '',
    technicalToolText: '',
    technicalLogText: '',
    toolStatusLastText: '',
    ...input,
  };
}
