import type { BotCommand, InlineKeyboardMarkup } from 'grammy/types';

export type { BotCommand, InlineKeyboardMarkup };

export interface TelegramTextMessageDto {
  chatId: number;
  userId: number;
  text: string;
  chatType?: string;
  messageThreadId?: number;
}

export interface TelegramCallbackDto {
  id: string;
  userId: number;
  data?: string;
  chatId?: number;
  messageId?: number;
  chatType?: string;
  messageThreadId?: number;
}

export interface SendMessageInput {
  chatId: number;
  messageThreadId?: number;
  text: string;
  parseMode?: 'MarkdownV2' | 'none';
  replyMarkup?: InlineKeyboardMarkup;
}

export interface EditMessageTextInput {
  chatId: number;
  messageThreadId?: number;
  messageId: number;
  text: string;
  parseMode?: 'MarkdownV2' | 'none';
}

export interface DeleteMessageInput {
  chatId: number;
  messageThreadId?: number;
  messageId: number;
}

export interface SendChatActionInput {
  chatId: number;
  messageThreadId?: number;
  action: 'typing';
}

export interface AnswerCallbackQueryInput {
  callbackQueryId: string;
  text?: string;
}
