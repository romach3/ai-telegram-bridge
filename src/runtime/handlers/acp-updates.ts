import { randomBytes } from 'node:crypto';
import {
  describeUpdate,
  extractPermissionOptions,
  extractSessionId,
  extractUpdate,
  getAgentTextChunk,
  getAgentThoughtChunk,
  getUserTextChunk,
  isRecord,
} from '../../acp/events';
import {
  requireSessionByScope,
  savePermission,
  upsertSession,
} from '../../state';
import type { TelegramBotApi } from '../../telegram/bot-api';
import type { JsonObject, JsonValue } from '../../types';
import { log } from '../../utils/logger';
import {
  formatPermissionOptionLabel,
  formatPermissionRequestText,
} from '../policy/permissions';
import type { LiveTurnRenderer } from '../rendering/live-turn';
import {
  extractLatestStatusLine,
  extractLiveOutput,
  normalizePromptText,
} from '../rendering/text';
import type { TurnContextRegistry } from '../state/turn-context-registry';
import type { TurnContext } from '../types';

export class AcpUpdateHandler {
  constructor(
    private readonly bot: TelegramBotApi,
    private readonly live: LiveTurnRenderer,
    private readonly contexts: TurnContextRegistry,
    private readonly logAcpEvent: (message: JsonObject) => Promise<void>,
  ) {}

  async handleMessage(agentId: string, message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.method !== 'string') return;
    void this.logAcpEvent({ agentId, ...message });
    if (message.method === 'session/update') {
      await this.handleSessionUpdate(agentId, message);
      return;
    }

    if (message.method === 'session/request_permission') {
      await this.handlePermissionRequest(agentId, message);
    }
  }

  private async handleSessionUpdate(
    agentId: string,
    message: JsonObject,
  ): Promise<void> {
    const acpSessionId = extractSessionId(message.params);
    const context = this.contexts.forAcpUpdate(agentId, acpSessionId);
    if (!context) return;
    const update = extractUpdate(message.params);
    const userChunk = getUserTextChunk(update);
    if (userChunk) {
      this.handleUserPromptChunk(context, userChunk);
      return;
    }
    const chunk = getAgentTextChunk(update);
    if (chunk) {
      await this.handleAgentTextChunk(context, chunk);
      return;
    }
    const thoughtChunk = getAgentThoughtChunk(update);
    if (thoughtChunk) {
      await this.live.updateTechnicalThought(
        context,
        extractLatestStatusLine(thoughtChunk),
      );
      return;
    }
    if (context.collectingCurrentPrompt) {
      await this.handleNonTextUpdate(context, update);
    }
  }

  private async handleAgentTextChunk(
    context: TurnContext,
    chunk: string,
  ): Promise<void> {
    if (!context.collectingCurrentPrompt) {
      context.collectingCurrentPrompt = true;
      context.buffer = '';
      context.preToolAgentBuffer = '';
      context.currentAgentStatusSegment = '';
      context.sawToolEvent = false;
      context.activeToolCallIds = new Set();
      log('started collecting answer from first agent chunk');
    }
    if (!context.sawToolEvent || context.activeToolCallIds.size > 0) {
      context.currentAgentStatusSegment += chunk;
      const statusLine = extractLatestStatusLine(
        context.currentAgentStatusSegment,
      );
      if (statusLine)
        await this.live.updateTechnicalThought(context, statusLine);
      return;
    }
    context.buffer += chunk;
  }

  private async handlePermissionRequest(
    agentId: string,
    message: JsonObject,
  ): Promise<void> {
    if (message.id === undefined || message.id === null) return;
    const requestId =
      typeof message.id === 'string' || typeof message.id === 'number'
        ? message.id
        : null;
    if (requestId === null) return;
    const options = extractPermissionOptions(message.params);
    const sessionId = extractSessionId(message.params) ?? '';
    const context = this.contexts.forAcpUpdate(agentId, sessionId || null);
    if (!context?.collectingCurrentPrompt) return;
    const callbackKey = randomBytes(6).toString('hex');
    const keyboard = options.map((option, index) => [
      {
        text: formatPermissionOptionLabel(option),
        callback_data: `perm:${callbackKey}:${index}`,
      },
    ]);
    const sentMessageId = await this.bot.sendMessage({
      chatId: context.chatId,
      messageThreadId: context.messageThreadId,
      text: formatPermissionRequestText(message.params),
      replyMarkup: { inline_keyboard: keyboard },
    });
    await savePermission({
      id: requestId,
      callbackKey,
      chatId: context.chatId,
      messageThreadId: context.messageThreadId,
      scopeId: context.scopeId,
      sessionId,
      agentId,
      messageId: sentMessageId,
      toolCall: isRecord(message.params)
        ? (message.params.toolCall ?? null)
        : null,
      options,
      createdAt: new Date().toISOString(),
    });
    const session = await requireSessionByScope(context.scopeId);
    await upsertSession({
      ...session,
      status: 'waiting_permission',
      updatedAt: new Date().toISOString(),
    });
  }

  private handleUserPromptChunk(context: TurnContext, chunk: string): void {
    if (!context.activePrompt || context.collectingCurrentPrompt) return;
    const target = normalizePromptText(context.pendingPromptText);
    const next = normalizePromptText(context.pendingUserText + chunk);
    if (next === target) {
      context.collectingCurrentPrompt = true;
      context.buffer = '';
      return;
    }
    if (target.startsWith(next)) {
      context.pendingUserText += chunk;
      return;
    }
    const fresh = normalizePromptText(chunk);
    if (fresh === target) {
      context.collectingCurrentPrompt = true;
      context.buffer = '';
      return;
    }
    context.pendingUserText = target.startsWith(fresh) ? chunk : '';
  }

  private async handleNonTextUpdate(
    context: TurnContext,
    update: JsonValue | undefined,
  ): Promise<void> {
    if (
      isRecord(update) &&
      (update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update')
    ) {
      if (update.sessionUpdate === 'tool_call') {
        await this.live.promotePendingAgentTextToTechnical(context);
        const description = describeUpdate(update);
        if (description)
          await this.live.updateTechnicalTool(context, description);
      }
      context.sawToolEvent = true;
      this.updateActiveToolCalls(context, update);
    }
    const output = extractLiveOutput(update);
    if (output) {
      await this.live.updateTechnicalLog(context, output);
      return;
    }
    const description = describeUpdate(update);
    if (
      description &&
      (!isRecord(update) || update.sessionUpdate !== 'tool_call')
    ) {
      await this.live.updateTechnicalTool(context, description);
    }
  }

  private updateActiveToolCalls(
    context: TurnContext,
    update: JsonObject,
  ): void {
    const toolCallId =
      typeof update.toolCallId === 'string' ? update.toolCallId : null;
    if (!toolCallId) return;
    const status = typeof update.status === 'string' ? update.status : '';
    if (status === 'in_progress' || status === 'pending') {
      context.activeToolCallIds.add(toolCallId);
      return;
    }
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      context.activeToolCallIds.delete(toolCallId);
    }
  }
}
