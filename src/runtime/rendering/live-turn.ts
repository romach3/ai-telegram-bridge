import type { TelegramBotApi } from '../../telegram/bot-api';
import {
  renderTelegramMarkdownChunks,
  sendTelegramChunks,
  sendTelegramPlainChunks,
} from '../../telegram/messages';
import { log, warn } from '../../utils/logger';
import type { TurnContext } from '../types';
import {
  compactStatusText,
  errorMessage,
  extractLatestStatusLine,
  renderTechnicalStatus,
  statusCodeBlock,
} from './text';

const TECHNICAL_STATUS_FLUSH_MS = 350;
const TYPING_REFRESH_MS = 4000;

export class LiveTurnRenderer {
  constructor(private readonly bot: TelegramBotApi) {}

  async updateToolStatus(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    await this.updateTechnicalThought(context, description);
  }

  async updateTechnicalThought(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalThoughtText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
  }

  async updateTechnicalTool(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalToolText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
  }

  async updateTechnicalLog(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalLogText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
  }

  async promotePendingAgentTextToTechnical(
    context: TurnContext,
  ): Promise<void> {
    const candidate =
      context.buffer.trim() || context.currentAgentStatusSegment.trim();
    if (!candidate) return;
    const statusLine = extractLatestStatusLine(candidate);
    context.buffer = '';
    context.currentAgentStatusSegment = '';
    if (statusLine) await this.updateTechnicalThought(context, statusLine);
  }

  resetTechnicalText(context: TurnContext): void {
    context.currentAgentStatusSegment = '';
    context.technicalThoughtText = '';
    context.technicalToolText = '';
    context.technicalLogText = '';
  }

  async finishToolStatus(context: TurnContext, text: string): Promise<void> {
    if (context.toolStatusTimer) {
      clearTimeout(context.toolStatusTimer);
      context.toolStatusTimer = undefined;
    }
    context.technicalThoughtText = compactStatusText(text);
    context.toolStatusText = renderTechnicalStatus(
      context.technicalThoughtText,
      context.technicalToolText,
      context.technicalLogText,
    );
    await this.flushToolStatus(context);
  }

  async startTyping(context: TurnContext): Promise<void> {
    this.stopTyping(context);
    await this.sendTyping(context);
    context.typingTimer = setInterval(
      () => void this.sendTyping(context),
      TYPING_REFRESH_MS,
    );
  }

  stopTyping(context: TurnContext): void {
    if (!context.typingTimer) return;
    clearInterval(context.typingTimer);
    context.typingTimer = undefined;
  }

  releaseToolStatus(context: TurnContext): void {
    if (context.toolStatusTimer) {
      clearTimeout(context.toolStatusTimer);
      context.toolStatusTimer = undefined;
    }
    context.toolStatusMessageId = undefined;
    context.toolStatusText = '';
    context.toolStatusLastText = '';
    this.resetTechnicalText(context);
  }

  async sendFinalAnswer(context: TurnContext): Promise<void> {
    const answer =
      context.buffer.trim() ||
      context.currentAgentStatusSegment.trim() ||
      context.preToolAgentBuffer.trim();
    log(
      `final answer buffer chars=${context.buffer.length} pre-tool chars=${context.preToolAgentBuffer.length} sawTool=${context.sawToolEvent} send chars=${answer.length}`,
    );
    if (!answer) return;
    try {
      if (context.toolStatusMessageId) {
        await this.replaceTechnicalMessageWithAnswer(context, answer);
      } else {
        await sendTelegramChunks(
          this.bot,
          context.chatId,
          answer,
          context.messageThreadId,
        );
      }
    } catch (error) {
      warn(
        `Telegram final answer MarkdownV2 send failed, retrying as plain text: ${errorMessage(error)}`,
      );
      try {
        await sendTelegramPlainChunks(
          this.bot,
          context.chatId,
          answer,
          context.messageThreadId,
        );
      } catch (plainError) {
        warn(
          `Telegram final answer plain send failed: ${errorMessage(plainError)}`,
        );
        return;
      }
    }
    log('final answer sent');
  }

  private async scheduleTechnicalFlush(context: TurnContext): Promise<void> {
    context.toolStatusText = renderTechnicalStatus(
      context.technicalThoughtText,
      context.technicalToolText,
      context.technicalLogText,
    );
    if (context.toolStatusTimer) return;
    context.toolStatusTimer = setTimeout(() => {
      context.toolStatusTimer = undefined;
      void this.flushToolStatus(context);
    }, TECHNICAL_STATUS_FLUSH_MS);
  }

  private async flushToolStatus(context: TurnContext): Promise<void> {
    context.toolStatusText = renderTechnicalStatus(
      context.technicalThoughtText,
      context.technicalToolText,
      context.technicalLogText,
    );
    if (!context.toolStatusText) return;
    const text = statusCodeBlock(context.toolStatusText);
    if (text === context.toolStatusLastText) return;
    if (!context.toolStatusMessageId) {
      try {
        context.toolStatusMessageId = await this.bot.sendMessage({
          chatId: context.chatId,
          messageThreadId: context.messageThreadId,
          text,
        });
        context.toolStatusLastText = text;
      } catch (error) {
        warn(`Telegram technical status send skipped: ${errorMessage(error)}`);
      }
      return;
    }
    try {
      await this.bot.editMessageText({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        messageId: context.toolStatusMessageId,
        text,
      });
      context.toolStatusLastText = text;
    } catch (error) {
      warn(`Telegram technical status edit skipped: ${errorMessage(error)}`);
    }
  }

  private async sendTyping(context: TurnContext): Promise<void> {
    try {
      await this.bot.sendChatAction({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        action: 'typing',
      });
    } catch {
      // Typing is a transient Telegram hint; it must not affect turn execution.
    }
  }

  private async replaceTechnicalMessageWithAnswer(
    context: TurnContext,
    markdown: string,
  ): Promise<void> {
    const chunks = renderTelegramMarkdownChunks(markdown);
    if (!chunks.length || !context.toolStatusMessageId) return;
    try {
      await this.bot.editMessageText({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        messageId: context.toolStatusMessageId,
        text: chunks[0],
      });
    } catch (error) {
      warn(
        `Telegram final answer edit failed, sending as new message: ${errorMessage(error)}`,
      );
      await sendTelegramChunks(
        this.bot,
        context.chatId,
        markdown,
        context.messageThreadId,
      );
      context.toolStatusMessageId = undefined;
      context.toolStatusText = '';
      context.toolStatusLastText = '';
      this.resetTechnicalText(context);
      return;
    }
    for (const chunk of chunks.slice(1)) {
      await this.bot.sendMessage({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        text: chunk,
      });
    }
    context.toolStatusMessageId = undefined;
    context.toolStatusText = '';
    context.toolStatusLastText = '';
    this.resetTechnicalText(context);
  }
}
