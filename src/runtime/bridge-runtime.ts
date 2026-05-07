import { randomBytes } from 'node:crypto';
import { appendAcpEventLog, defaultAcpEventLogPath } from '../acp/event-log';
import {
  describeUpdate,
  extractPermissionOptions,
  extractSessionId,
  extractUpdate,
  getAgentTextChunk,
  getAgentThoughtChunk,
  getUserTextChunk,
  isRecord,
} from '../acp/events';
import { createAcpAgents } from '../acp/stdio-agent';
import {
  clearPermissions,
  getPermission,
  getSessionByScope,
  markInterruptedSessionsFailed,
  readPermissions,
  readSessions,
  replaceSessions,
  requireSessionByScope,
  savePermission,
  scopeIdForPrivateChat,
  sessionScopeId,
  takePermission,
  upsertSession,
} from '../state';
import { TelegramBotApi } from '../telegram/bot-api';
import { HELP_LINES, VISIBLE_TELEGRAM_COMMANDS } from '../telegram/commands';
import { codeBlock, inlineCode, plainText } from '../telegram/markdown';
import {
  renderTelegramMarkdownChunks,
  sendTelegramChunks,
  sendTelegramPlainChunks,
} from '../telegram/messages';
import {
  labelFromPrompt,
  sessionDisplayLabel,
} from '../telegram/session-labels';
import type {
  AcpAgent,
  BridgeConfig,
  BridgeSessionDto,
  JsonObject,
  JsonValue,
  TelegramCallbackDto,
  TelegramTextMessageDto,
} from '../types';
import { log, warn } from '../utils/logger';
import { sessionKey } from './acp-routing';
import {
  authorizedScope,
  isAuthorizedTelegramInput,
  isPermissionCallbackContext,
  scopeFromTelegramInput,
} from './authorization';
import {
  findSafeDenialOption,
  formatPermissionOptionLabel,
  formatPermissionRequestText,
  isExpiredPermission,
} from './permissions';
import { normalizeSessions } from './sessions';
import {
  compactStatusText,
  delay,
  errorMessage,
  extractLatestStatusLine,
  extractLiveOutput,
  normalizePromptText,
  renderTechnicalStatus,
  statusCodeBlock,
} from './text';
import type { ConversationScope, ResumeMenu, TurnContext } from './types';

export class BridgeRuntime {
  private readonly bot: TelegramBotApi;
  private readonly agents: Map<string, AcpAgent>;
  private readonly contexts = new Map<string, TurnContext>();
  private readonly scopeByAcpSession = new Map<string, string>();
  private readonly resumeMenus = new Map<string, ResumeMenu>();
  private readonly loadedSessions = new Set<string>();
  private readonly initializedAgents = new Set<string>();

  constructor(private readonly config: BridgeConfig) {
    this.bot = new TelegramBotApi(config.botToken);
    this.agents = createAcpAgents(config);
    for (const agent of this.agents.values()) {
      agent.on(
        'message',
        (message) => void this.handleAcpMessage(agent.id, message),
      );
      agent.on('stderr', (value) => {
        const text = String(value).trim();
        if (text) warn(`[${agent.id}] ${text}`);
      });
    }
  }

  async start(): Promise<void> {
    const agent = this.defaultAgent();
    await this.resetInterruptedState();
    await this.ensureAgentInitialized(agent);
    await this.registerTelegramCommands();
    await this.warnIfWebhookConfigured();
    this.bot.onText((message) => this.handleTextEvent(message));
    this.bot.onCallback((callback) => this.handleCallbackEvent(callback));
    this.bot.onError((error) =>
      warn(
        `Telegram bot failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    log(`ACP agent initialized: ${agent.id}`);
    await this.bot.start(this.config.pollTimeoutSeconds);
  }

  private async handleTextEvent(
    message: TelegramTextMessageDto,
  ): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      await this.reportBridgeError(scopeFromTelegramInput(message), error);
    }
  }

  private async handleCallbackEvent(
    callback: TelegramCallbackDto,
  ): Promise<void> {
    try {
      await this.handleCallback(callback);
    } catch (error) {
      if (callback.chatId)
        await this.reportBridgeError(
          scopeFromTelegramInput({
            chatId: callback.chatId,
            messageThreadId: callback.messageThreadId,
          }),
          error,
        );
      else warn(error instanceof Error ? error.message : String(error));
    }
  }

  private async reportBridgeError(
    scope: ConversationScope,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: plainText(`Bridge error: ${message}`),
    });
    warn(message);
  }

  private async handleMessage(message: TelegramTextMessageDto): Promise<void> {
    const scope = authorizedScope(message, this.config);
    if (!scope) {
      if (message.userId === this.config.allowedUserId) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          messageThreadId: message.messageThreadId,
          text: plainText(
            'Use a private chat or a topic in a configured group.',
          ),
        });
      }
      return;
    }

    const text = message.text.trim();

    if (text.startsWith('/new')) {
      await this.handleNew(scope);
      return;
    }
    if (text.startsWith('/resume')) {
      await this.handleResume(scope);
      return;
    }
    if (text.startsWith('/compact')) {
      await this.handleCompact(scope);
      return;
    }
    if (text.startsWith('/cancel')) {
      await this.handleCancel(scope);
      return;
    }
    if (text.startsWith('/status')) {
      await this.handleStatus(scope);
      return;
    }
    if (text.startsWith('/agents')) {
      await this.handleAgents(scope);
      return;
    }
    if (text.startsWith('/help') || text.startsWith('/start')) {
      await this.sendHelp(scope);
      return;
    }

    if (text.startsWith('/')) {
      await this.bot.sendMessage({
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
        text: `${plainText('Unknown command:')} ${inlineCode(text.split(/\s+/)[0])}\n${plainText('Send /help.')}`,
      });
      return;
    }

    await this.handlePrompt(scope, text);
  }

  private async handleNew(scope: ConversationScope): Promise<void> {
    const context = this.getContext(scope);
    if (context.activePrompt) {
      await this.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running in this topic. Send /cancel to stop the current turn.',
      );
      return;
    }
    if (this.agents.size > 1) {
      const keyboard = [...this.agents.values()].map((agent) => [
        {
          text: agent.label,
          callback_data: `new:${agent.id}`,
        },
      ]);
      await this.bot.sendMessage({
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
        text: plainText('Choose agent:'),
        replyMarkup: { inline_keyboard: keyboard },
      });
      return;
    }
    await this.createNewSession(scope, this.defaultAgent());
  }

  private async createNewSession(
    scope: ConversationScope,
    agent: AcpAgent,
  ): Promise<void> {
    const cwd = this.config.defaultCwd;
    await this.ensureAgentInitialized(agent);
    const result = await agent.createSession({ cwd });
    this.loadedSessions.add(sessionKey(agent.id, result.sessionId));
    await upsertSession(
      this.makeSession(scope, agent.id, result.sessionId, cwd, 'idle'),
    );
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: `${plainText(`New ${agent.label} session created.`)}\n${plainText('Send the first task to name it automatically.')}`,
    });
  }

  private async handleResume(scope: ConversationScope): Promise<void> {
    const context = this.getContext(scope);
    if (context.activePrompt) {
      await this.bot.sendMessage({
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
        text: plainText(
          'ACP agent is still running in this topic. Send /cancel first.',
        ),
      });
      return;
    }
    const sessions = await this.recentSessions();
    if (!sessions.length) {
      await this.bot.sendMessage({
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
        text: plainText('No resumable sessions. Send /new first.'),
      });
      return;
    }
    const callbackKey = randomBytes(6).toString('hex');
    this.resumeMenus.set(callbackKey, {
      ...scope,
      sessions,
      createdAt: Date.now(),
    });
    const keyboard = sessions.map((session, index) => [
      {
        text: sessionDisplayLabel(session, this.agentForSession(session)),
        callback_data: `resume:${callbackKey}:${index}`,
      },
    ]);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: plainText('Resume session:'),
      replyMarkup: { inline_keyboard: keyboard },
    });
  }

  private async handleCompact(scope: ConversationScope): Promise<void> {
    const context = this.getContext(scope);
    if (context.activePrompt) {
      await this.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }
    const session = await requireSessionByScope(scope.scopeId);
    await this.ensureSessionLoaded(session);
    this.prepareContextForPrompt(
      context,
      '/compact',
      this.agentForSession(session).id,
      session.acpSessionId,
    );
    await this.startTyping(context);
    await upsertSession({
      ...session,
      ...scope,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.scopeByAcpSession.set(
      sessionKey(this.agentForSession(session).id, session.acpSessionId),
      scope.scopeId,
    );
    void this.runPrompt(context, { ...session, ...scope }, '/compact');
  }

  private async handleCancel(scope: ConversationScope): Promise<void> {
    const session = await requireSessionByScope(scope.scopeId);
    this.agentForSession(session).cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    this.scopeByAcpSession.delete(
      sessionKey(this.agentForSession(session).id, session.acpSessionId),
    );
    const context = this.getContext(scope);
    await this.resetActivePromptState(context);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: plainText('Cancel sent.'),
    });
  }

  private async handleStatus(scope: ConversationScope): Promise<void> {
    const session = await requireSessionByScope(scope.scopeId);
    const agent = this.agentForSession(session);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: [
        `${plainText('Status:')} ${inlineCode(session.status)}`,
        `${plainText('Session:')} ${inlineCode(sessionDisplayLabel(session, agent))}`,
        `${plainText('Agent:')} ${inlineCode(agent.label)} ${plainText('(')}${inlineCode(agent.id)}${plainText(')')}`,
        `${plainText('ACP session:')}\n${codeBlock(session.acpSessionId)}`,
        `${plainText('CWD:')}\n${codeBlock(session.cwd)}`,
      ].join('\n'),
    });
  }

  private async handleAgents(scope: ConversationScope): Promise<void> {
    const lines = [...this.agents.values()].map((agent) => {
      const marker = agent.id === this.config.defaultAgent ? '*' : '-';
      return `${marker} ${agent.id}: ${agent.label}`;
    });
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: codeBlock(lines.join('\n')),
    });
  }

  private async sendHelp(scope: ConversationScope): Promise<void> {
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: codeBlock(HELP_LINES.join('\n')),
    });
  }

  private async registerTelegramCommands(): Promise<void> {
    try {
      await this.bot.setMyCommands(VISIBLE_TELEGRAM_COMMANDS);
    } catch (error) {
      warn(`Telegram command registration failed: ${errorMessage(error)}`);
    }
  }

  private async handlePrompt(
    scope: ConversationScope,
    text: string,
  ): Promise<void> {
    const context = this.getContext(scope);
    await this.recoverStalePermissionWait(scope, context);
    if (context.activePrompt) {
      await this.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }

    const session =
      (await this.getOrCreateSessionForScope(scope)) ??
      (await requireSessionByScope(scope.scopeId));
    await this.ensureSessionLoaded(session);
    const promptText = text;
    const nextSession = session.label
      ? session
      : {
          ...session,
          label: labelFromPrompt(promptText),
        };
    this.prepareContextForPrompt(
      context,
      promptText,
      this.agentForSession(nextSession).id,
      nextSession.acpSessionId,
    );
    await this.startTyping(context);
    await upsertSession({
      ...nextSession,
      ...scope,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.scopeByAcpSession.set(
      sessionKey(
        this.agentForSession(nextSession).id,
        nextSession.acpSessionId,
      ),
      scope.scopeId,
    );
    void this.runPrompt(context, { ...nextSession, ...scope }, promptText);
  }

  private async runPrompt(
    context: TurnContext,
    session: BridgeSessionDto,
    text: string,
  ): Promise<void> {
    try {
      const result = await this.agentForSession(session).prompt({
        sessionId: session.acpSessionId,
        text,
      });
      await delay(1000);
      this.stopTyping(context);
      await this.sendFinalAnswer(context);
      await upsertSession({
        ...session,
        status: 'idle',
        updatedAt: new Date().toISOString(),
      });
      if (result.stopReason !== 'end_turn') {
        await this.bot.sendMessage({
          chatId: context.chatId,
          messageThreadId: context.messageThreadId,
          text: `${plainText('Turn finished:')} ${inlineCode(result.stopReason)}`,
        });
      }
    } catch (error) {
      this.stopTyping(context);
      await this.sendFinalAnswer(context);
      await upsertSession({
        ...session,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      });
      if (context.toolStatusMessageId)
        await this.finishToolStatus(context, 'Failed.');
      await this.bot.sendMessage({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        text: plainText(
          `ACP error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      });
    } finally {
      this.scopeByAcpSession.delete(
        sessionKey(this.agentForSession(session).id, session.acpSessionId),
      );
      await this.resetActivePromptState(context);
    }
  }

  private async handleCallback(callback: TelegramCallbackDto): Promise<void> {
    if (!isAuthorizedTelegramInput(callback, this.config)) {
      await this.answerCallbackBestEffort(callback, 'Unauthorized user.');
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
    if (!data.startsWith('perm:')) return;
    const [, callbackKey, optionIndex] = data.split(':');
    const permission = await getPermission(callbackKey);
    if (!permission) {
      const scope = callback.chatId
        ? scopeFromTelegramInput({
            chatId: callback.chatId,
            messageThreadId: callback.messageThreadId,
          })
        : null;
      if (scope) await this.markStalePermissionWait(scope);
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
      await takePermission(callbackKey);
      const denialOption = findSafeDenialOption(permission.options);
      if (denialOption) {
        this.getAgent(permission.agentId ?? this.config.defaultAgent).respond(
          permission.id,
          {
            outcome: {
              outcome: 'selected',
              optionId: denialOption.optionId,
            },
          },
        );
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
      await this.markStalePermissionWait({
        chatId: permission.chatId,
        messageThreadId: permission.messageThreadId,
        scopeId:
          permission.scopeId ??
          scopeFromTelegramInput({
            chatId: permission.chatId,
            messageThreadId: permission.messageThreadId,
          }).scopeId,
      });
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
    this.getAgent(permission.agentId ?? this.config.defaultAgent).respond(
      permission.id,
      {
        outcome: {
          outcome: 'selected',
          optionId: option.optionId,
        },
      },
    );
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
    const context = this.getContext(scope);
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
    await this.createNewSession(scope, this.getAgent(agentId));
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
    const context = this.getContext(scope);
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
    const agent = this.agentForSession(session);
    await this.ensureAgentInitialized(agent);
    await agent.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    this.loadedSessions.add(sessionKey(agent.id, session.acpSessionId));
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

  private async handleAcpMessage(
    agentId: string,
    message: unknown,
  ): Promise<void> {
    if (!isRecord(message) || typeof message.method !== 'string') return;
    void this.logAcpEvent({ agentId, ...message });
    if (message.method === 'session/update') {
      const acpSessionId = extractSessionId(message.params);
      const context = this.contextForAcpUpdate(agentId, acpSessionId);
      if (!context) return;
      const update = extractUpdate(message.params);
      const userChunk = getUserTextChunk(update);
      if (userChunk) {
        this.handleUserPromptChunk(context, userChunk);
        return;
      }
      const chunk = getAgentTextChunk(update);
      if (chunk) {
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
          {
            const statusLine = extractLatestStatusLine(
              context.currentAgentStatusSegment,
            );
            if (statusLine)
              await this.updateTechnicalThought(context, statusLine);
          }
          return;
        }
        context.buffer += chunk;
        return;
      }
      const thoughtChunk = getAgentThoughtChunk(update);
      if (thoughtChunk) {
        await this.updateTechnicalThought(
          context,
          extractLatestStatusLine(thoughtChunk),
        );
        return;
      }
      if (context.collectingCurrentPrompt) {
        await this.handleNonTextUpdate(context, update);
      }
      return;
    }

    if (message.method === 'session/request_permission') {
      await this.handlePermissionRequest(agentId, message);
    }
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
    const context = this.contextForAcpUpdate(agentId, sessionId || null);
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
        await this.promotePendingAgentTextToTechnical(context);
        const description = describeUpdate(update);
        if (description) await this.updateTechnicalTool(context, description);
      }
      context.sawToolEvent = true;
      this.updateActiveToolCalls(context, update);
    }
    const output = extractLiveOutput(update);
    if (output) {
      await this.updateTechnicalLog(context, output);
      return;
    }
    const description = describeUpdate(update);
    if (
      description &&
      (!isRecord(update) || update.sessionUpdate !== 'tool_call')
    ) {
      await this.updateTechnicalTool(context, description);
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

  private async promotePendingAgentTextToTechnical(
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

  private resetTechnicalText(context: TurnContext): void {
    context.currentAgentStatusSegment = '';
    context.technicalThoughtText = '';
    context.technicalToolText = '';
    context.technicalLogText = '';
  }

  private async updateToolStatus(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    await this.updateTechnicalThought(context, description);
  }

  private async updateTechnicalThought(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalThoughtText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
  }

  private async updateTechnicalTool(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalToolText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
  }

  private async updateTechnicalLog(
    context: TurnContext,
    description: string,
  ): Promise<void> {
    context.technicalLogText = compactStatusText(description);
    await this.scheduleTechnicalFlush(context);
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
    }, 350);
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

  private releaseToolStatus(context: TurnContext): void {
    if (context.toolStatusTimer) {
      clearTimeout(context.toolStatusTimer);
      context.toolStatusTimer = undefined;
    }
    context.toolStatusMessageId = undefined;
    context.toolStatusText = '';
    context.toolStatusLastText = '';
    this.resetTechnicalText(context);
  }

  private async finishToolStatus(
    context: TurnContext,
    text: string,
  ): Promise<void> {
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

  private async startTyping(context: TurnContext): Promise<void> {
    this.stopTyping(context);
    await this.sendTyping(context);
    context.typingTimer = setInterval(
      () => void this.sendTyping(context),
      4000,
    );
  }

  private stopTyping(context: TurnContext): void {
    if (!context.typingTimer) return;
    clearInterval(context.typingTimer);
    context.typingTimer = undefined;
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

  private async sendFinalAnswer(context: TurnContext): Promise<void> {
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

  private makeSession(
    scope: ConversationScope,
    agentId: string,
    acpSessionId: string,
    cwd: string,
    status: BridgeSessionDto['status'],
  ): BridgeSessionDto {
    const now = new Date().toISOString();
    return {
      telegramUserId: this.config.allowedUserId,
      chatId: scope.chatId,
      scopeId: scope.scopeId,
      messageThreadId: scope.messageThreadId,
      agentId,
      acpSessionId,
      cwd,
      status,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async ensureSessionLoaded(session: BridgeSessionDto): Promise<void> {
    const agent = this.agentForSession(session);
    const key = sessionKey(agent.id, session.acpSessionId);
    if (this.loadedSessions.has(key)) return;
    await this.ensureAgentInitialized(agent);
    await agent.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    this.loadedSessions.add(key);
  }

  private async recentSessions(): Promise<BridgeSessionDto[]> {
    const sessions = await readSessions();
    const normalized = normalizeSessions(
      sessions,
      this.config.defaultAgent,
      new Set(this.agents.keys()),
    );
    if (normalized.changed) await replaceSessions(normalized.sessions);
    return normalized.sessions
      .filter((session) => session.telegramUserId === this.config.allowedUserId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  private async getOrCreateSessionForScope(
    scope: ConversationScope,
  ): Promise<BridgeSessionDto | undefined> {
    const existing = await getSessionByScope(scope.scopeId);
    if (existing) return existing;
    const agent = this.defaultAgent();
    const cwd = this.config.defaultCwd;
    await this.ensureAgentInitialized(agent);
    const result = await agent.createSession({ cwd });
    this.loadedSessions.add(sessionKey(agent.id, result.sessionId));
    const session = this.makeSession(
      scope,
      agent.id,
      result.sessionId,
      cwd,
      'idle',
    );
    await upsertSession(session);
    return session;
  }

  private getContext(scope: ConversationScope): TurnContext {
    const existing = this.contexts.get(scope.scopeId);
    if (existing) {
      existing.chatId = scope.chatId;
      existing.messageThreadId = scope.messageThreadId;
      return existing;
    }
    const context: TurnContext = {
      ...scope,
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
    };
    this.contexts.set(scope.scopeId, context);
    return context;
  }

  private prepareContextForPrompt(
    context: TurnContext,
    promptText: string,
    agentId: string,
    acpSessionId: string,
  ): void {
    context.activePrompt = true;
    context.activeAgentId = agentId;
    context.activeAcpSessionId = acpSessionId;
    context.buffer = '';
    context.pendingPromptText = promptText;
    context.pendingUserText = '';
    context.collectingCurrentPrompt = false;
    context.preToolAgentBuffer = '';
    this.resetTechnicalText(context);
    context.sawToolEvent = false;
    context.activeToolCallIds = new Set();
  }

  private contextForAcpUpdate(
    agentId: string,
    acpSessionId: string | null,
  ): TurnContext | undefined {
    if (acpSessionId) {
      const scopeId = this.scopeByAcpSession.get(
        sessionKey(agentId, acpSessionId),
      );
      if (scopeId) return this.contexts.get(scopeId);
    }

    const activeContexts = [...this.contexts.values()].filter(
      (context) => context.activePrompt && context.activeAgentId === agentId,
    );
    if (activeContexts.length === 1) return activeContexts[0];
    if (activeContexts.length > 1) {
      warn(
        `ACP update without sessionId is ambiguous for agent ${agentId}; active turns=${activeContexts.length}`,
      );
    }
    return undefined;
  }

  private async resetActivePromptState(context: TurnContext): Promise<void> {
    this.stopTyping(context);
    this.releaseToolStatus(context);
    context.pendingPromptText = '';
    context.pendingUserText = '';
    context.collectingCurrentPrompt = false;
    context.preToolAgentBuffer = '';
    this.resetTechnicalText(context);
    context.sawToolEvent = false;
    context.activeToolCallIds = new Set();
    context.activePrompt = false;
    context.activeAgentId = undefined;
    context.activeAcpSessionId = undefined;
  }

  private async recoverStalePermissionWait(
    scope: ConversationScope,
    context: TurnContext,
  ): Promise<void> {
    const session = await getSessionByScope(scope.scopeId);
    if (session?.status !== 'waiting_permission') return;
    if (await this.hasPendingPermissionForScope(scope.scopeId)) return;
    this.agentForSession(session).cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
    await this.resetActivePromptState(context);
  }

  private async markStalePermissionWait(
    scope: ConversationScope,
  ): Promise<void> {
    const session = await getSessionByScope(scope.scopeId);
    if (session?.status !== 'waiting_permission') return;
    if (await this.hasPendingPermissionForScope(scope.scopeId)) return;
    await upsertSession({
      ...session,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
  }

  private async hasPendingPermissionForScope(
    scopeId: string,
  ): Promise<boolean> {
    const permissions = await readPermissions();
    return permissions.some((permission) => {
      const permissionScopeId =
        permission.scopeId ??
        scopeFromTelegramInput({
          chatId: permission.chatId,
          messageThreadId: permission.messageThreadId,
        }).scopeId;
      return permissionScopeId === scopeId;
    });
  }

  private defaultAgent(): AcpAgent {
    return this.getAgent(this.config.defaultAgent);
  }

  private getAgent(agentId: string): AcpAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown ACP agent: ${agentId}`);
    return agent;
  }

  private agentForSession(session: BridgeSessionDto): AcpAgent {
    return this.getAgent(session.agentId ?? this.config.defaultAgent);
  }

  private async ensureAgentInitialized(agent: AcpAgent): Promise<void> {
    if (this.initializedAgents.has(agent.id)) return;
    agent.start();
    await agent.initialize();
    this.initializedAgents.add(agent.id);
  }

  private async logAcpEvent(message: JsonObject): Promise<void> {
    const filePath =
      this.config.acpEventLogPath === 'default'
        ? defaultAcpEventLogPath()
        : this.config.acpEventLogPath;
    if (!filePath) return;
    try {
      await appendAcpEventLog(filePath, message);
    } catch (error) {
      warn(
        `ACP event log failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async resetInterruptedState(): Promise<void> {
    await clearPermissions();
    await markInterruptedSessionsFailed();
  }

  private async warnIfWebhookConfigured(): Promise<void> {
    try {
      const info = await this.bot.getWebhookInfo();
      if (!info.url) return;
      warn(
        [
          'Telegram webhook is configured for this bot token.',
          'Polling bridge instances compete with webhooks or other consumers.',
          'Use one bot token for one bridge instance, or rotate/create a token.',
        ].join(' '),
      );
    } catch (error) {
      warn(`Telegram webhook diagnostic failed: ${errorMessage(error)}`);
    }
  }

  private async answerCallbackBestEffort(
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

export async function serveBridge(config: BridgeConfig): Promise<void> {
  const runtime = new BridgeRuntime(config);
  await runtime.start();
}
