import { scopeIdForPrivateChat, scopeIdForTopic } from '../state';
import type { BridgeConfig, TelegramCallbackDto } from '../types';
import type { ConversationScope } from './types';

export function isAuthorizedTelegramInput(
  input: {
    userId: number;
    chatId?: number;
    chatType?: string;
    messageThreadId?: number;
  },
  config: Pick<BridgeConfig, 'allowedUserId' | 'allowedChats'>,
): boolean {
  return Boolean(authorizedScope(input, config));
}

export function authorizedScope(
  input: {
    userId: number;
    chatId?: number;
    chatType?: string;
    messageThreadId?: number;
  },
  config: Pick<BridgeConfig, 'allowedUserId' | 'allowedChats'>,
): ConversationScope | null {
  if (input.userId !== config.allowedUserId) return null;
  if (input.chatId === undefined) return null;
  if (!input.chatType || input.chatType === 'private') {
    if (input.chatId !== config.allowedUserId) return null;
    return scopeFromTelegramInput({ chatId: input.chatId });
  }
  if (input.chatType !== 'group' && input.chatType !== 'supergroup')
    return null;
  if (input.messageThreadId === undefined) return null;
  if (!config.allowedChats.some((chat) => chat.chatId === input.chatId))
    return null;
  return scopeFromTelegramInput({
    chatId: input.chatId,
    messageThreadId: input.messageThreadId,
  });
}

export function scopeFromTelegramInput(input: {
  chatId: number;
  messageThreadId?: number;
}): ConversationScope {
  return {
    chatId: input.chatId,
    messageThreadId: input.messageThreadId,
    scopeId:
      input.messageThreadId === undefined
        ? scopeIdForPrivateChat(input.chatId)
        : scopeIdForTopic(input.chatId, input.messageThreadId),
  };
}

export function isPermissionCallbackContext(
  callback: TelegramCallbackDto,
  permission: { chatId: number; messageId?: number; messageThreadId?: number },
): boolean {
  if (callback.chatId !== permission.chatId) return false;
  if (callback.messageThreadId !== permission.messageThreadId) return false;
  if (
    permission.messageId !== undefined &&
    callback.messageId !== permission.messageId
  )
    return false;
  return true;
}
