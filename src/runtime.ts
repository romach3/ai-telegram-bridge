import { randomBytes } from 'node:crypto';
import { appendAcpEventLog, defaultAcpEventLogPath } from './acp/event-log';
import {
  describeUpdate,
  extractPermissionOptions,
  extractSessionId,
  extractUpdate,
  getAgentTextChunk,
  getAgentThoughtChunk,
  getUserTextChunk,
  isRecord,
} from './acp/events';
import { createAcpAgents } from './acp/stdio-agent';
import {
  clearPermissions,
  getPermission,
  markInterruptedSessionsFailed,
  readSessions,
  replaceSessions,
  requireSessionByChat,
  savePermission,
  takePermission,
  upsertSession,
} from './state';
import { TelegramBotApi } from './telegram/bot-api';
import { HELP_LINES, VISIBLE_TELEGRAM_COMMANDS } from './telegram/commands';
import { codeBlock, inlineCode, plainText } from './telegram/markdown';
import {
  renderTelegramMarkdownChunks,
  sendTelegramChunks,
} from './telegram/messages';
import {
  labelFromPrompt,
  sessionDisplayLabel,
} from './telegram/session-labels';
import type {
  AcpAgent,
  BridgeConfig,
  BridgeSessionDto,
  JsonObject,
  JsonValue,
  TelegramCallbackDto,
  TelegramTextMessageDto,
} from './types';
import { log, warn } from './utils/logger';

export class BridgeRuntime {
  private readonly bot: TelegramBotApi;
  private readonly agents: Map<string, AcpAgent>;
  private activePrompt = false;
  private activeChatId?: number;
  private buffer = '';
  private pendingPromptText = '';
  private pendingUserText = '';
  private collectingCurrentPrompt = false;
  private preToolAgentBuffer = '';
  private currentAgentStatusSegment = '';
  private sawToolEvent = false;
  private activeToolCallIds = new Set<string>();
  private typingTimer?: NodeJS.Timeout;
  private toolStatusMessageId?: number;
  private toolStatusText = '';
  private technicalThoughtText = '';
  private technicalToolText = '';
  private technicalLogText = '';
  private toolStatusTimer?: NodeJS.Timeout;
  private toolStatusLastText = '';
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
      await this.reportBridgeError(message.chatId, error);
    }
  }

  private async handleCallbackEvent(
    callback: TelegramCallbackDto,
  ): Promise<void> {
    try {
      await this.handleCallback(callback);
    } catch (error) {
      if (callback.chatId) await this.reportBridgeError(callback.chatId, error);
      else warn(error instanceof Error ? error.message : String(error));
    }
  }

  private async reportBridgeError(
    chatId: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.bot.sendMessage({
      chatId,
      text: plainText(`Bridge error: ${message}`),
    });
    warn(message);
  }

  private async handleMessage(message: TelegramTextMessageDto): Promise<void> {
    if (!isAuthorizedTelegramInput(message, this.config.allowedUserId)) return;

    const chatId = message.chatId;
    const text = message.text.trim();

    if (text.startsWith('/new')) {
      await this.handleNew(chatId);
      return;
    }
    if (text.startsWith('/resume')) {
      await this.handleResume(chatId);
      return;
    }
    if (text.startsWith('/compact')) {
      await this.handleCompact(chatId);
      return;
    }
    if (text.startsWith('/cancel')) {
      await this.handleCancel(chatId);
      return;
    }
    if (text.startsWith('/status')) {
      await this.handleStatus(chatId);
      return;
    }
    if (text.startsWith('/agents')) {
      await this.handleAgents(chatId);
      return;
    }
    if (text.startsWith('/help') || text.startsWith('/start')) {
      await this.sendHelp(chatId);
      return;
    }

    if (text.startsWith('/')) {
      await this.bot.sendMessage({
        chatId,
        text: `${plainText('Unknown command:')} ${inlineCode(text.split(/\s+/)[0])}\n${plainText('Send /help.')}`,
      });
      return;
    }

    await this.handlePrompt(chatId, text);
  }

  private async handleNew(chatId: number): Promise<void> {
    if (this.agents.size > 1) {
      const keyboard = [...this.agents.values()].map((agent) => [
        {
          text: agent.label,
          callback_data: `new:${agent.id}`,
        },
      ]);
      await this.bot.sendMessage({
        chatId,
        text: plainText('Choose agent:'),
        replyMarkup: { inline_keyboard: keyboard },
      });
      return;
    }
    await this.createNewSession(chatId, this.defaultAgent());
  }

  private async createNewSession(
    chatId: number,
    agent: AcpAgent,
  ): Promise<void> {
    const cwd = this.config.defaultCwd;
    await this.ensureAgentInitialized(agent);
    const result = await agent.createSession({ cwd });
    this.loadedSessions.add(sessionKey(agent.id, result.sessionId));
    await upsertSession(
      this.makeSession(chatId, agent.id, result.sessionId, cwd, 'idle'),
    );
    await this.bot.sendMessage({
      chatId,
      text: `${plainText(`New ${agent.label} session created.`)}\n${plainText('Send the first task to name it automatically.')}`,
    });
  }

  private async handleResume(chatId: number): Promise<void> {
    const sessions = await this.recentSessions(chatId);
    if (!sessions.length) {
      await this.bot.sendMessage({
        chatId,
        text: plainText('No resumable sessions. Send /new first.'),
      });
      return;
    }
    const keyboard = sessions.map((session, index) => [
      {
        text: sessionDisplayLabel(session, this.agentForSession(session)),
        callback_data: `resume:${index}`,
      },
    ]);
    await this.bot.sendMessage({
      chatId,
      text: plainText('Resume session:'),
      replyMarkup: { inline_keyboard: keyboard },
    });
  }

  private async handleCompact(chatId: number): Promise<void> {
    if (this.activePrompt) {
      await this.updateToolStatus(
        chatId,
        this.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }
    const session = await requireSessionByChat(chatId);
    await this.ensureSessionLoaded(session);
    this.activePrompt = true;
    this.activeChatId = chatId;
    this.buffer = '';
    this.pendingPromptText = '/compact';
    this.pendingUserText = '';
    this.collectingCurrentPrompt = false;
    this.preToolAgentBuffer = '';
    this.resetTechnicalText();
    this.sawToolEvent = false;
    this.activeToolCallIds = new Set();
    await this.startTyping(chatId);
    await upsertSession({
      ...session,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    void this.runPrompt(chatId, session, '/compact');
  }

  private async handleCancel(chatId: number): Promise<void> {
    const session = await requireSessionByChat(chatId);
    this.agentForSession(session).cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    await this.bot.sendMessage({ chatId, text: plainText('Cancel sent.') });
  }

  private async handleStatus(chatId: number): Promise<void> {
    const session = await requireSessionByChat(chatId);
    const agent = this.agentForSession(session);
    await this.bot.sendMessage({
      chatId,
      text: [
        `${plainText('Status:')} ${inlineCode(session.status)}`,
        `${plainText('Session:')} ${inlineCode(sessionDisplayLabel(session, agent))}`,
        `${plainText('Agent:')} ${inlineCode(agent.label)} ${plainText('(')}${inlineCode(agent.id)}${plainText(')')}`,
        `${plainText('ACP session:')}\n${codeBlock(session.acpSessionId)}`,
        `${plainText('CWD:')}\n${codeBlock(session.cwd)}`,
      ].join('\n'),
    });
  }

  private async handleAgents(chatId: number): Promise<void> {
    const lines = [...this.agents.values()].map((agent) => {
      const marker = agent.id === this.config.defaultAgent ? '*' : '-';
      return `${marker} ${agent.id}: ${agent.label}`;
    });
    await this.bot.sendMessage({ chatId, text: codeBlock(lines.join('\n')) });
  }

  private async sendHelp(chatId: number): Promise<void> {
    await this.bot.sendMessage({
      chatId,
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

  private async handlePrompt(chatId: number, text: string): Promise<void> {
    if (this.activePrompt) {
      await this.updateToolStatus(
        chatId,
        this.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }

    const session = await requireSessionByChat(chatId);
    await this.ensureSessionLoaded(session);
    const promptText = text;
    const nextSession = session.label
      ? session
      : {
          ...session,
          label: labelFromPrompt(promptText),
        };
    this.activePrompt = true;
    this.activeChatId = chatId;
    this.buffer = '';
    this.pendingPromptText = promptText;
    this.pendingUserText = '';
    this.collectingCurrentPrompt = false;
    this.preToolAgentBuffer = '';
    this.resetTechnicalText();
    this.sawToolEvent = false;
    this.activeToolCallIds = new Set();
    await this.startTyping(chatId);
    await upsertSession({
      ...nextSession,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    void this.runPrompt(chatId, nextSession, promptText);
  }

  private async runPrompt(
    chatId: number,
    session: BridgeSessionDto,
    text: string,
  ): Promise<void> {
    try {
      const result = await this.agentForSession(session).prompt({
        sessionId: session.acpSessionId,
        text,
      });
      await delay(1000);
      this.stopTyping();
      await this.sendFinalAnswer(chatId);
      await upsertSession({
        ...session,
        status: 'idle',
        updatedAt: new Date().toISOString(),
      });
      if (result.stopReason !== 'end_turn') {
        await this.bot.sendMessage({
          chatId,
          text: `${plainText('Turn finished:')} ${inlineCode(result.stopReason)}`,
        });
      }
    } catch (error) {
      this.stopTyping();
      await this.sendFinalAnswer(chatId);
      await upsertSession({
        ...session,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      });
      if (this.toolStatusMessageId)
        await this.finishToolStatus(chatId, 'Failed.');
      await this.bot.sendMessage({
        chatId,
        text: plainText(
          `ACP error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      });
    } finally {
      await this.resetActivePromptState();
    }
  }

  private async handleCallback(callback: TelegramCallbackDto): Promise<void> {
    if (!isAuthorizedTelegramInput(callback, this.config.allowedUserId)) {
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
      return;
    }
    const option = permission.options[Number(optionIndex)];
    if (!option) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission option not found.',
      });
      return;
    }
    const consumed = await takePermission(callbackKey);
    if (!consumed) {
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
    const session = await requireSessionByChat(permission.chatId);
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
    await this.createNewSession(chatId, this.getAgent(agentId));
  }

  private async handleResumeCallback(
    callback: TelegramCallbackDto,
    data: string,
  ): Promise<void> {
    const chatId = callback.chatId;
    if (!chatId) return;
    if (this.activePrompt) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'ACP agent is still running.',
      });
      return;
    }
    const [, rawIndex] = data.split(':');
    const sessions = await this.recentSessions(chatId);
    const session = sessions[Number(rawIndex)];
    if (!session) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Session not found.',
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
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    await this.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: 'Session loaded.',
    });
    if (callback.messageId)
      await this.bot.deleteMessage({ chatId, messageId: callback.messageId });
    await this.bot.sendMessage({
      chatId,
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
      const update = extractUpdate(message.params);
      const userChunk = getUserTextChunk(update);
      if (userChunk) {
        this.handleUserPromptChunk(userChunk);
        return;
      }
      const chunk = getAgentTextChunk(update);
      if (chunk) {
        if (!this.collectingCurrentPrompt) {
          this.collectingCurrentPrompt = true;
          this.buffer = '';
          this.preToolAgentBuffer = '';
          this.currentAgentStatusSegment = '';
          this.sawToolEvent = false;
          this.activeToolCallIds = new Set();
          log('started collecting answer from first agent chunk');
        }
        if (!this.sawToolEvent || this.activeToolCallIds.size > 0) {
          this.currentAgentStatusSegment += chunk;
          if (this.activeChatId) {
            const statusLine = extractLatestStatusLine(
              this.currentAgentStatusSegment,
            );
            if (statusLine)
              await this.updateTechnicalThought(this.activeChatId, statusLine);
          }
          return;
        }
        this.buffer += chunk;
        return;
      }
      const thoughtChunk = getAgentThoughtChunk(update);
      if (thoughtChunk) {
        if (this.activeChatId)
          await this.updateTechnicalThought(
            this.activeChatId,
            extractLatestStatusLine(thoughtChunk),
          );
        return;
      }
      if (this.activeChatId && this.collectingCurrentPrompt) {
        await this.handleNonTextUpdate(this.activeChatId, update);
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
    if (
      message.id === undefined ||
      message.id === null ||
      !this.activeChatId ||
      !this.collectingCurrentPrompt
    )
      return;
    const requestId =
      typeof message.id === 'string' || typeof message.id === 'number'
        ? message.id
        : null;
    if (requestId === null) return;
    const options = extractPermissionOptions(message.params);
    const sessionId = extractSessionId(message.params) ?? '';
    const callbackKey = randomBytes(6).toString('hex');
    const keyboard = options.map((option, index) => [
      {
        text: option.name ?? option.optionId,
        callback_data: `perm:${callbackKey}:${index}`,
      },
    ]);
    const sentMessageId = await this.bot.sendMessage({
      chatId: this.activeChatId,
      text: `${plainText('ACP agent requests permission:')}\n${codeBlock(JSON.stringify(isRecord(message.params) ? message.params.toolCall : {}, null, 2).slice(0, 2500))}`,
      replyMarkup: { inline_keyboard: keyboard },
    });
    await savePermission({
      id: requestId,
      callbackKey,
      chatId: this.activeChatId,
      sessionId,
      agentId,
      messageId: sentMessageId,
      toolCall: isRecord(message.params)
        ? (message.params.toolCall ?? null)
        : null,
      options,
      createdAt: new Date().toISOString(),
    });
    if (this.activeChatId) {
      const session = await requireSessionByChat(this.activeChatId);
      await upsertSession({
        ...session,
        status: 'waiting_permission',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private handleUserPromptChunk(chunk: string): void {
    if (!this.activePrompt || this.collectingCurrentPrompt) return;
    const target = normalizePromptText(this.pendingPromptText);
    const next = normalizePromptText(this.pendingUserText + chunk);
    if (next === target) {
      this.collectingCurrentPrompt = true;
      this.buffer = '';
      return;
    }
    if (target.startsWith(next)) {
      this.pendingUserText += chunk;
      return;
    }
    const fresh = normalizePromptText(chunk);
    if (fresh === target) {
      this.collectingCurrentPrompt = true;
      this.buffer = '';
      return;
    }
    this.pendingUserText = target.startsWith(fresh) ? chunk : '';
  }

  private async handleNonTextUpdate(
    chatId: number,
    update: JsonValue | undefined,
  ): Promise<void> {
    if (
      isRecord(update) &&
      (update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update')
    ) {
      if (update.sessionUpdate === 'tool_call') {
        await this.promotePendingAgentTextToTechnical(chatId);
        const description = describeUpdate(update);
        if (description) await this.updateTechnicalTool(chatId, description);
      }
      this.sawToolEvent = true;
      this.updateActiveToolCalls(update);
    }
    const output = extractLiveOutput(update);
    if (output) {
      await this.updateTechnicalLog(chatId, output);
      return;
    }
    const description = describeUpdate(update);
    if (
      description &&
      (!isRecord(update) || update.sessionUpdate !== 'tool_call')
    ) {
      await this.updateTechnicalTool(chatId, description);
    }
  }

  private updateActiveToolCalls(update: JsonObject): void {
    const toolCallId =
      typeof update.toolCallId === 'string' ? update.toolCallId : null;
    if (!toolCallId) return;
    const status = typeof update.status === 'string' ? update.status : '';
    if (status === 'in_progress' || status === 'pending') {
      this.activeToolCallIds.add(toolCallId);
      return;
    }
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      this.activeToolCallIds.delete(toolCallId);
    }
  }

  private async promotePendingAgentTextToTechnical(
    chatId: number,
  ): Promise<void> {
    const candidate =
      this.buffer.trim() || this.currentAgentStatusSegment.trim();
    if (!candidate) return;
    const statusLine = extractLatestStatusLine(candidate);
    this.buffer = '';
    this.currentAgentStatusSegment = '';
    if (statusLine) await this.updateTechnicalThought(chatId, statusLine);
  }

  private resetTechnicalText(): void {
    this.currentAgentStatusSegment = '';
    this.technicalThoughtText = '';
    this.technicalToolText = '';
    this.technicalLogText = '';
  }

  private async updateToolStatus(
    chatId: number,
    description: string,
  ): Promise<void> {
    await this.updateTechnicalThought(chatId, description);
  }

  private async updateTechnicalThought(
    chatId: number,
    description: string,
  ): Promise<void> {
    this.technicalThoughtText = compactStatusText(description);
    await this.scheduleTechnicalFlush(chatId);
  }

  private async updateTechnicalTool(
    chatId: number,
    description: string,
  ): Promise<void> {
    this.technicalToolText = compactStatusText(description);
    await this.scheduleTechnicalFlush(chatId);
  }

  private async updateTechnicalLog(
    chatId: number,
    description: string,
  ): Promise<void> {
    this.technicalLogText = compactStatusText(description);
    await this.scheduleTechnicalFlush(chatId);
  }

  private async scheduleTechnicalFlush(chatId: number): Promise<void> {
    this.toolStatusText = renderTechnicalStatus(
      this.technicalThoughtText,
      this.technicalToolText,
      this.technicalLogText,
    );
    if (this.toolStatusTimer) return;
    this.toolStatusTimer = setTimeout(() => {
      this.toolStatusTimer = undefined;
      void this.flushToolStatus(chatId);
    }, 350);
  }

  private async flushToolStatus(chatId: number): Promise<void> {
    this.toolStatusText = renderTechnicalStatus(
      this.technicalThoughtText,
      this.technicalToolText,
      this.technicalLogText,
    );
    if (!this.toolStatusText) return;
    const text = statusCodeBlock(this.toolStatusText);
    if (text === this.toolStatusLastText) return;
    if (!this.toolStatusMessageId) {
      try {
        this.toolStatusMessageId = await this.bot.sendMessage({ chatId, text });
        this.toolStatusLastText = text;
      } catch (error) {
        warn(`Telegram technical status send skipped: ${errorMessage(error)}`);
      }
      return;
    }
    try {
      await this.bot.editMessageText({
        chatId,
        messageId: this.toolStatusMessageId,
        text,
      });
      this.toolStatusLastText = text;
    } catch (error) {
      warn(`Telegram technical status edit skipped: ${errorMessage(error)}`);
    }
  }

  private releaseToolStatus(): void {
    if (this.toolStatusTimer) {
      clearTimeout(this.toolStatusTimer);
      this.toolStatusTimer = undefined;
    }
    this.toolStatusMessageId = undefined;
    this.toolStatusText = '';
    this.toolStatusLastText = '';
    this.resetTechnicalText();
  }

  private async finishToolStatus(chatId: number, text: string): Promise<void> {
    if (this.toolStatusTimer) {
      clearTimeout(this.toolStatusTimer);
      this.toolStatusTimer = undefined;
    }
    this.technicalThoughtText = compactStatusText(text);
    this.toolStatusText = renderTechnicalStatus(
      this.technicalThoughtText,
      this.technicalToolText,
      this.technicalLogText,
    );
    await this.flushToolStatus(chatId);
  }

  private async startTyping(chatId: number): Promise<void> {
    this.stopTyping();
    await this.sendTyping(chatId);
    this.typingTimer = setInterval(() => void this.sendTyping(chatId), 4000);
  }

  private stopTyping(): void {
    if (!this.typingTimer) return;
    clearInterval(this.typingTimer);
    this.typingTimer = undefined;
  }

  private async sendTyping(chatId: number): Promise<void> {
    try {
      await this.bot.sendChatAction({ chatId, action: 'typing' });
    } catch {
      // Typing is a transient Telegram hint; it must not affect turn execution.
    }
  }

  private async sendFinalAnswer(chatId: number): Promise<void> {
    const answer =
      this.buffer.trim() ||
      this.currentAgentStatusSegment.trim() ||
      this.preToolAgentBuffer.trim();
    log(
      `final answer buffer chars=${this.buffer.length} pre-tool chars=${this.preToolAgentBuffer.length} sawTool=${this.sawToolEvent} send chars=${answer.length}`,
    );
    if (!answer) return;
    try {
      if (this.toolStatusMessageId) {
        await this.replaceTechnicalMessageWithAnswer(chatId, answer);
      } else {
        await sendTelegramChunks(this.bot, chatId, answer);
      }
    } catch (error) {
      warn(`Telegram final answer send failed: ${errorMessage(error)}`);
      return;
    }
    log('final answer sent');
  }

  private async replaceTechnicalMessageWithAnswer(
    chatId: number,
    markdown: string,
  ): Promise<void> {
    const chunks = renderTelegramMarkdownChunks(markdown);
    if (!chunks.length || !this.toolStatusMessageId) return;
    try {
      await this.bot.editMessageText({
        chatId,
        messageId: this.toolStatusMessageId,
        text: chunks[0],
      });
    } catch (error) {
      warn(
        `Telegram final answer edit failed, sending as new message: ${errorMessage(error)}`,
      );
      await sendTelegramChunks(this.bot, chatId, markdown);
      this.toolStatusMessageId = undefined;
      this.toolStatusText = '';
      this.toolStatusLastText = '';
      this.resetTechnicalText();
      return;
    }
    for (const chunk of chunks.slice(1)) {
      await this.bot.sendMessage({ chatId, text: chunk });
    }
    this.toolStatusMessageId = undefined;
    this.toolStatusText = '';
    this.toolStatusLastText = '';
    this.resetTechnicalText();
  }

  private makeSession(
    chatId: number,
    agentId: string,
    acpSessionId: string,
    cwd: string,
    status: BridgeSessionDto['status'],
  ): BridgeSessionDto {
    const now = new Date().toISOString();
    return {
      telegramUserId: this.config.allowedUserId,
      chatId,
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

  private async recentSessions(chatId: number): Promise<BridgeSessionDto[]> {
    const sessions = await readSessions();
    const normalized = normalizeSessions(
      sessions,
      this.config.defaultAgent,
      new Set(this.agents.keys()),
    );
    if (normalized.changed) await replaceSessions(normalized.sessions);
    return normalized.sessions
      .filter(
        (session) =>
          session.telegramUserId === this.config.allowedUserId &&
          session.chatId === chatId,
      )
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 5);
  }

  private async resetActivePromptState(): Promise<void> {
    this.stopTyping();
    this.releaseToolStatus();
    this.pendingPromptText = '';
    this.pendingUserText = '';
    this.collectingCurrentPrompt = false;
    this.preToolAgentBuffer = '';
    this.resetTechnicalText();
    this.sawToolEvent = false;
    this.activeToolCallIds = new Set();
    this.activePrompt = false;
    this.activeChatId = undefined;
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
}

export function isAuthorizedTelegramInput(
  input: { userId: number; chatId?: number; chatType?: string },
  allowedUserId: number,
): boolean {
  if (input.userId !== allowedUserId) return false;
  if (input.chatType && input.chatType !== 'private') return false;
  if (input.chatId !== undefined && input.chatId !== allowedUserId)
    return false;
  return true;
}

export function isPermissionCallbackContext(
  callback: TelegramCallbackDto,
  permission: { chatId: number; messageId?: number },
): boolean {
  if (callback.chatId !== permission.chatId) return false;
  if (
    permission.messageId !== undefined &&
    callback.messageId !== permission.messageId
  )
    return false;
  return true;
}

const PERMISSION_TTL_MS = 15 * 60 * 1000;

export function isExpiredPermission(input: { createdAt: string }): boolean {
  const createdAt = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt > PERMISSION_TTL_MS;
}

export function normalizeSessions(
  sessions: BridgeSessionDto[],
  defaultAgent: string,
  configuredAgents: Set<string>,
): { sessions: BridgeSessionDto[]; changed: boolean } {
  let changed = false;
  const next: BridgeSessionDto[] = [];
  for (const session of sessions) {
    const agentId = session.agentId ?? defaultAgent;
    if (!configuredAgents.has(agentId)) {
      changed = true;
      continue;
    }
    if (session.agentId) {
      next.push(session);
      continue;
    }
    changed = true;
    next.push({ ...session, agentId });
  }
  return { sessions: next, changed };
}

export function findSafeDenialOption<
  T extends { optionId: string; kind?: string; name?: string },
>(options: T[]): T | undefined {
  return (
    options.find((option) => isSafeDenialValue(option.kind)) ??
    options.find((option) => isSafeDenialValue(option.optionId)) ??
    options.find((option) => isSafeDenialValue(option.name))
  );
}

function isSafeDenialValue(value: string | undefined): boolean {
  if (!value) return false;
  return /^(deny|denied|reject|rejected|cancel|cancelled|disallow|refuse|refused)$/i.test(
    value.trim(),
  );
}

function normalizePromptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function compactStatusText(value: string): string {
  const cleaned = sanitizeStatusText(value);
  const lines = cleaned
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.at(-1) ?? value.trim();
  if (text.length <= 900) return text;
  return `...${text.slice(-897)}`;
}

function statusCodeBlock(value: string): string {
  return value
    .split('\n')
    .filter(Boolean)
    .map((line) => inlineCode(line))
    .join('\n');
}

function renderTechnicalStatus(
  thought: string,
  tool: string,
  logLine: string,
): string {
  return [thought, tool, logLine].filter(Boolean).join('\n');
}

function sanitizeStatusText(value: string): string {
  const lines = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^```[a-zA-Z0-9_-]*\s*$/, '')
        .replace(/^```\s*$/, '')
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !line.startsWith('Warning: Basic terminal detected'))
    .filter(
      (line) => !line.startsWith('Warning: 256-color support not detected'),
    )
    .filter(
      (line) => line !== 'Ripgrep is not available. Falling back to GrepTool.',
    );
  return (
    lines.join('\n').trim() ||
    value
      .replace(/```[a-zA-Z0-9_-]*/g, '')
      .replace(/```/g, '')
      .trim()
  );
}

function stripTerminalNoise(value: string): string {
  return value
    .replace(/Warning: Basic terminal detected[^\n]*/g, '')
    .replace(/Warning: 256-color support not detected[^\n]*/g, '')
    .replace(/Ripgrep is not available\. Falling back to GrepTool\./g, '')
    .trim();
}

function extractLatestStatusLine(value: string): string {
  const compact = repairSentenceBoundarySpacing(
    normalizePromptText(sanitizeStatusText(value)),
  );
  if (!compact) return '';
  const matches = compact.match(/[^.!?。！？]+[.!?。！？]+/g);
  const text = matches?.at(-1)?.trim() ?? compact;
  if (text.length <= 900) return text;
  return `...${text.slice(-897)}`;
}

function repairSentenceBoundarySpacing(value: string): string {
  return value.replace(/([.!?])([A-ZА-ЯЁ])/g, '$1 $2');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

function extractLiveOutput(update: JsonValue | undefined): string | null {
  if (!isRecord(update) || update.sessionUpdate !== 'tool_call_update')
    return null;
  const contentText = extractContentText(update.content);
  if (contentText) return stripTerminalNoise(contentText);
  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string' && rawOutput.trim())
    return stripTerminalNoise(rawOutput);
  if (!isRecord(rawOutput)) return null;
  const output =
    rawOutput.formatted_output ??
    rawOutput.aggregated_output ??
    rawOutput.stdout ??
    rawOutput.stderr;
  return typeof output === 'string' && output.trim()
    ? stripTerminalNoise(output)
    : null;
}

function extractContentText(content: JsonValue | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const chunks: string[] = [];
  for (const item of content) {
    if (!isRecord(item) || !isRecord(item.content)) continue;
    const inner = item.content;
    if (inner.type === 'text' && typeof inner.text === 'string')
      chunks.push(inner.text);
  }
  const text = chunks.join('\n').trim();
  return text || null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function serveBridge(config: BridgeConfig): Promise<void> {
  const runtime = new BridgeRuntime(config);
  await runtime.start();
}
