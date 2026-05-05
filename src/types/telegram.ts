import { BotCommand, InlineKeyboardMarkup } from 'grammy/types';

export type { BotCommand, InlineKeyboardMarkup };

export interface BridgeTextMessage {
  chatId: number;
  userId: number;
  text: string;
}

export interface BridgeCallback {
  id: string;
  userId: number;
  data?: string;
  chatId?: number;
  messageId?: number;
}

export interface SendMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface EditMessageTextInput {
  chatId: number;
  messageId: number;
  text: string;
}

export interface DeleteMessageInput {
  chatId: number;
  messageId: number;
}

export interface SendChatActionInput {
  chatId: number;
  action: 'typing';
}

export interface AnswerCallbackQueryInput {
  callbackQueryId: string;
  text?: string;
}
