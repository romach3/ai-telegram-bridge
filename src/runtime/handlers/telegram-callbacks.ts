import { sessionScopeId, upsertSession } from '../../state';
import type { TelegramBotApi } from '../../telegram/bot-api';
import { codeBlock, plainText } from '../../telegram/markdown';
import type { BridgeConfig, TelegramCallbackDto } from '../../types';
import {
  isAuthorizedTelegramInput,
  scopeFromTelegramInput,
} from '../policy/authorization';
import type { AgentRuntimeService } from '../services/agent-service';
import type { PermissionWaitService } from '../services/permission-wait-service';
import type { SessionRuntimeService } from '../services/session-service';
import type { TurnContextRegistry } from '../state/turn-context-registry';
import type { ResumeMenu } from '../types';
import { PermissionCallbackHandler } from './permission-callbacks';

export class TelegramCallbackHandler {
  private readonly permissionCallbacks: PermissionCallbackHandler;

  constructor(
    private readonly bot: TelegramBotApi,
    private readonly config: BridgeConfig,
    private readonly agents: AgentRuntimeService,
    private readonly sessions: SessionRuntimeService,
    permissionWait: PermissionWaitService,
    private readonly contexts: TurnContextRegistry,
    private readonly resumeMenus: Map<string, ResumeMenu>,
  ) {
    this.permissionCallbacks = new PermissionCallbackHandler(
      bot,
      config,
      agents,
      permissionWait,
    );
  }

  async handle(callback: TelegramCallbackDto): Promise<void> {
    if (!isAuthorizedTelegramInput(callback, this.config)) {
      await this.answerBestEffort(callback, 'Unauthorized user.');
      return;
    }
    const data = callback.data ?? '';
    if (data.startsWith('new:')) {
      await this.handleNewAgentCallback(callback, data);
      return;
    }
    if (data.startsWith('resume:')) {
      await this.handleResumeCallback(callback, data);
      return;
    }
    if (data.startsWith('perm:')) {
      await this.permissionCallbacks.handle(callback, data);
    }
  }

  private async handleNewAgentCallback(
    callback: TelegramCallbackDto,
    data: string,
  ): Promise<void> {
    const chatId = callback.chatId;
    if (!chatId) return;
    const scope = scopeFromTelegramInput({
      chatId,
      messageThreadId: callback.messageThreadId,
    });
    const context = this.contexts.get(scope);
    if (context.activePrompt) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'ACP agent is still running in this topic.',
      });
      return;
    }
    const [, agentId] = data.split(':');
    if (!this.agents.has(agentId)) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Agent not found.',
      });
      return;
    }
    await this.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: 'Creating session.',
    });
    if (callback.messageId)
      await this.bot.deleteMessage({ chatId, messageId: callback.messageId });
    const agent = this.agents.get(agentId);
    await this.sessions.createNew(scope, agent);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: `${plainText(`New ${agent.label} session created.`)}\n${plainText('Send the first task to name it automatically.')}`,
    });
  }

  private async handleResumeCallback(
    callback: TelegramCallbackDto,
    data: string,
  ): Promise<void> {
    const chatId = callback.chatId;
    if (!chatId) return;
    const scope = scopeFromTelegramInput({
      chatId,
      messageThreadId: callback.messageThreadId,
    });
    const context = this.contexts.get(scope);
    if (context.activePrompt) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'ACP agent is still running in this topic.',
      });
      return;
    }
    const [, callbackKey, rawIndex] = data.split(':');
    const menu = this.resumeMenus.get(callbackKey);
    if (!menu || menu.scopeId !== scope.scopeId) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Resume request not found.',
      });
      return;
    }
    const session = menu.sessions[Number(rawIndex)];
    if (!session) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Session not found.',
      });
      return;
    }
    if (
      session.status === 'running' &&
      sessionScopeId(session) !== scope.scopeId
    ) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Session is running in another topic.',
      });
      return;
    }
    const agent = this.agents.forSession(session);
    await this.agents.ensureInitialized(agent);
    await agent.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    await upsertSession({
      ...session,
      ...scope,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    this.resumeMenus.delete(callbackKey);
    await this.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: 'Session loaded.',
    });
    if (callback.messageId)
      await this.bot.deleteMessage({ chatId, messageId: callback.messageId });
    await this.bot.sendMessage({
      chatId,
      messageThreadId: scope.messageThreadId,
      text: `${plainText(`Resumed ${agent.label} session:`)}\n${codeBlock(session.acpSessionId)}\n${plainText('CWD:')}\n${codeBlock(session.cwd)}`,
    });
  }

  private async answerBestEffort(
    callback: TelegramCallbackDto,
    text: string,
  ): Promise<void> {
    try {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text,
      });
    } catch {
      // Unauthorized or stale callbacks must never affect bridge execution.
    }
  }
}
