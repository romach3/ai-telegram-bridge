import {
  getPermission,
  requireSessionByScope,
  scopeIdForPrivateChat,
  takePermission,
  upsertSession,
} from '../../state';
import type { TelegramBotApi } from '../../telegram/bot-api';
import type { BridgeConfig, TelegramCallbackDto } from '../../types';
import {
  isPermissionCallbackContext,
  scopeFromTelegramInput,
} from '../policy/authorization';
import {
  findSafeDenialOption,
  isExpiredPermission,
} from '../policy/permissions';
import type { AgentRuntimeService } from '../services/agent-service';
import type { PermissionWaitService } from '../services/permission-wait-service';

export class PermissionCallbackHandler {
  constructor(
    private readonly bot: TelegramBotApi,
    private readonly config: BridgeConfig,
    private readonly agents: AgentRuntimeService,
    private readonly permissionWait: PermissionWaitService,
  ) {}

  async handle(callback: TelegramCallbackDto, data: string): Promise<void> {
    const [, callbackKey, optionIndex] = data.split(':');
    const permission = await getPermission(callbackKey);
    if (!permission) {
      const scope = callback.chatId
        ? scopeFromTelegramInput({
            chatId: callback.chatId,
            messageThreadId: callback.messageThreadId,
          })
        : null;
      if (scope) await this.permissionWait.markStaleWait(scope);
      await this.deleteCallbackMessageBestEffort(callback);
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission request not found.',
      });
      return;
    }
    if (!isPermissionCallbackContext(callback, permission)) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission context mismatch.',
      });
      return;
    }
    if (isExpiredPermission(permission)) {
      await this.handleExpired(callback, callbackKey, permission);
      return;
    }
    const option = permission.options[Number(optionIndex)];
    if (!option) {
      await this.deleteStoredPermissionMessageBestEffort(permission);
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission option not found.',
      });
      return;
    }
    const consumed = await takePermission(callbackKey);
    if (!consumed) {
      await this.deleteStoredPermissionMessageBestEffort(permission);
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission request already handled.',
      });
      return;
    }
    this.agents
      .get(permission.agentId ?? this.config.defaultAgent)
      .respond(permission.id, {
        outcome: {
          outcome: 'selected',
          optionId: option.optionId,
        },
      });
    await this.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: `Selected: ${option.optionId}`,
    });
    if (permission.messageId) {
      await this.bot.deleteMessage({
        chatId: permission.chatId,
        messageId: permission.messageId,
      });
    }
    const session = await requireSessionByScope(
      permission.scopeId ?? scopeIdForPrivateChat(permission.chatId),
    );
    await upsertSession({
      ...session,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
  }

  private async handleExpired(
    callback: TelegramCallbackDto,
    callbackKey: string,
    permission: NonNullable<Awaited<ReturnType<typeof getPermission>>>,
  ): Promise<void> {
    await takePermission(callbackKey);
    const denialOption = findSafeDenialOption(permission.options);
    if (denialOption) {
      this.agents
        .get(permission.agentId ?? this.config.defaultAgent)
        .respond(permission.id, {
          outcome: {
            outcome: 'selected',
            optionId: denialOption.optionId,
          },
        });
    }
    await this.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: denialOption
        ? 'Permission expired; sent safe denial.'
        : 'Permission expired or bridge was restarted. Send /cancel if the turn is still waiting.',
    });
    if (permission.messageId) {
      await this.bot.deleteMessage({
        chatId: permission.chatId,
        messageId: permission.messageId,
      });
    }
    await this.permissionWait.markStaleWait({
      chatId: permission.chatId,
      messageThreadId: permission.messageThreadId,
      scopeId:
        permission.scopeId ??
        scopeFromTelegramInput({
          chatId: permission.chatId,
          messageThreadId: permission.messageThreadId,
        }).scopeId,
    });
  }

  private async deleteCallbackMessageBestEffort(
    callback: TelegramCallbackDto,
  ): Promise<void> {
    if (!callback.chatId || !callback.messageId) return;
    await this.bot.deleteMessage({
      chatId: callback.chatId,
      messageId: callback.messageId,
    });
  }

  private async deleteStoredPermissionMessageBestEffort(permission: {
    chatId: number;
    messageId?: number;
  }): Promise<void> {
    if (!permission.messageId) return;
    await this.bot.deleteMessage({
      chatId: permission.chatId,
      messageId: permission.messageId,
    });
  }
}
