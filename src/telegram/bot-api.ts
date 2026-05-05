import { Bot, GrammyError } from 'grammy';
import type { MaybeInaccessibleMessage } from 'grammy/types';
import type {
  AnswerCallbackQueryInput,
  BotCommand,
  DeleteMessageInput,
  EditMessageTextInput,
  SendChatActionInput,
  SendMessageInput,
  TelegramCallbackDto,
  TelegramTextMessageDto,
  TelegramWebhookInfo,
} from '../types';

export class TelegramBotApi {
  private readonly bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  onText(handler: (message: TelegramTextMessageDto) => Promise<void>): void {
    this.bot.on('message:text', async (ctx) => {
      if (!ctx.from) return;
      await handler({
        chatId: ctx.chat.id,
        chatType: ctx.chat.type,
        userId: ctx.from.id,
        text: ctx.message.text,
      });
    });
  }

  onCallback(handler: (callback: TelegramCallbackDto) => Promise<void>): void {
    this.bot.on('callback_query:data', async (ctx) => {
      const message = accessibleMessage(ctx.callbackQuery.message);
      await handler({
        id: ctx.callbackQuery.id,
        userId: ctx.callbackQuery.from.id,
        data: ctx.callbackQuery.data,
        chatId: message?.chat.id,
        chatType: message?.chat.type,
        messageId: message?.message_id,
      });
    });
  }

  onError(handler: (error: unknown) => void): void {
    this.bot.catch((error) => {
      handler(error.error);
    });
  }

  async start(timeoutSeconds: number): Promise<void> {
    await this.bot.start({
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  async setMyCommands(commands: BotCommand[]): Promise<void> {
    await this.bot.api.setMyCommands(commands);
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    const info = await this.bot.api.getWebhookInfo();
    return {
      url: info.url ?? '',
      pendingUpdateCount: info.pending_update_count,
    };
  }

  async sendMessage(input: SendMessageInput): Promise<number | undefined> {
    const message = await this.bot.api.sendMessage(input.chatId, input.text, {
      parse_mode: 'MarkdownV2',
      link_preview_options: { is_disabled: true },
      reply_markup: input.replyMarkup,
    });
    return message.message_id;
  }

  async editMessageText(input: EditMessageTextInput): Promise<void> {
    try {
      await this.bot.api.editMessageText(
        input.chatId,
        input.messageId,
        input.text,
        {
          parse_mode: 'MarkdownV2',
          link_preview_options: { is_disabled: true },
        },
      );
    } catch (error) {
      if (isTelegramDescription(error, 'message is not modified')) return;
      throw error;
    }
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    try {
      await this.bot.api.deleteMessage(input.chatId, input.messageId);
    } catch {
      // Status cleanup is best-effort; old or already-deleted messages should not fail the bridge.
    }
  }

  async sendChatAction(input: SendChatActionInput): Promise<void> {
    await this.bot.api.sendChatAction(input.chatId, input.action);
  }

  async answerCallbackQuery(input: AnswerCallbackQueryInput): Promise<void> {
    await this.bot.api.answerCallbackQuery(input.callbackQueryId, {
      text: input.text,
    });
  }
}

function accessibleMessage(
  message: MaybeInaccessibleMessage | undefined,
): Extract<MaybeInaccessibleMessage, { date: number }> | undefined {
  if (!message || !('date' in message)) return undefined;
  return message;
}

function isTelegramDescription(error: unknown, text: string): boolean {
  return error instanceof GrammyError && error.description.includes(text);
}
