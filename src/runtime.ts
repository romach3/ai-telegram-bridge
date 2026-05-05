import { randomBytes } from 'node:crypto';
import {
  appendAcpEventLog,
  defaultAcpEventLogPath,
} from './backend/acp/event-log';
import {
  describeUpdate,
  extractPermissionOptions,
  extractSessionId,
  extractUpdate,
  getAgentTextChunk,
  getAgentThoughtChunk,
  getUserTextChunk,
  isRecord,
} from './backend/acp/events';
import { createBackends } from './backend/registry';
import {
  readSessions,
  requireSessionByChat,
  savePermission,
  takePermission,
  upsertSession,
} from './state';
import { TelegramBotApi } from './telegram/bot-api';
import { codeBlock, inlineCode, plainText } from './telegram/markdown';
import {
  renderTelegramMarkdownChunks,
  sendTelegramChunks,
} from './telegram/messages';
import type {
  AcpBackend,
  BridgeCallback,
  BridgeConfig,
  BridgeSession,
  BridgeTextMessage,
  JsonObject,
  JsonValue,
} from './types';
import { log, warn } from './utils/logger';

export class BridgeRuntime {
  private readonly bot: TelegramBotApi;
  private readonly backends: Map<string, AcpBackend>;
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
  private readonly initializedBackends = new Set<string>();

  constructor(private readonly config: BridgeConfig) {
    this.bot = new TelegramBotApi(config.botToken);
    this.backends = createBackends(config);
    for (const backend of this.backends.values()) {
      backend.on(
        'message',
        (message) => void this.handleAcpMessage(backend.id, message),
      );
      backend.on('stderr', (value) => {
        const text = String(value).trim();
        if (text) warn(`[${backend.id}] ${text}`);
      });
    }
  }

  async start(): Promise<void> {
    const backend = this.defaultBackend();
    await this.ensureBackendInitialized(backend);
    await this.registerTelegramCommands();
    this.bot.onText((message) => this.handleTextEvent(message));
    this.bot.onCallback((callback) => this.handleCallbackEvent(callback));
    this.bot.onError((error) =>
      warn(
        `Telegram bot failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    log(`ACP backend initialized: ${backend.id}`);
    await this.bot.start(this.config.pollTimeoutSeconds);
  }

  private async handleTextEvent(message: BridgeTextMessage): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      await this.reportBridgeError(message.chatId, error);
    }
  }

  private async handleCallbackEvent(callback: BridgeCallback): Promise<void> {
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

  private async handleMessage(message: BridgeTextMessage): Promise<void> {
    if (message.userId !== this.config.allowedUserId) return;

    const chatId = message.chatId;
    const text = message.text.trim();

    if (text.startsWith('/new')) {
      await this.handleNew(chatId, text);
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
    if (text.startsWith('/load')) {
      await this.handleLoad(chatId, text);
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
    if (text.startsWith('/sessions')) {
      await this.handleSessions(chatId);
      return;
    }
    if (text.startsWith('/backends')) {
      await this.handleBackends(chatId);
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

  private async handleNew(chatId: number, text: string): Promise<void> {
    const { backend, cwd } = this.parseNewArgs(text);
    await this.ensureBackendInitialized(backend);
    const result = await backend.createSession({ cwd });
    this.loadedSessions.add(sessionKey(backend.id, result.sessionId));
    await upsertSession(
      this.makeSession(chatId, backend.id, result.sessionId, cwd, 'idle'),
    );
    await this.bot.sendMessage({
      chatId,
      text: `${plainText(`New ${backend.label} session:`)}\n${codeBlock(result.sessionId)}`,
    });
  }

  private async handleLoad(chatId: number, text: string): Promise<void> {
    const [, sessionId, backendOrCwd, maybeCwd] = text.split(/\s+/);
    if (!sessionId) {
      await this.bot.sendMessage({
        chatId,
        text: plainText('Usage: /load <sessionId> [backend] [cwd]'),
      });
      return;
    }
    const backend =
      backendOrCwd && this.backends.has(backendOrCwd)
        ? this.getBackend(backendOrCwd)
        : this.defaultBackend();
    const cwd =
      backendOrCwd && this.backends.has(backendOrCwd)
        ? (maybeCwd ?? this.config.defaultCwd)
        : (backendOrCwd ?? this.config.defaultCwd);
    await this.ensureBackendInitialized(backend);
    await backend.loadSession({ sessionId, cwd });
    this.loadedSessions.add(sessionKey(backend.id, sessionId));
    await upsertSession(
      this.makeSession(chatId, backend.id, sessionId, cwd, 'idle'),
    );
    await this.bot.sendMessage({
      chatId,
      text: `${plainText(`Loaded ${backend.label} session:`)}\n${codeBlock(sessionId)}`,
    });
  }

  private async handleResume(chatId: number): Promise<void> {
    const sessions = await this.recentSessions(chatId);
    if (!sessions.length) {
      await this.bot.sendMessage({
        chatId,
        text: plainText('No locally known sessions. Send /new first.'),
      });
      return;
    }
    const keyboard = sessions.map((session, index) => [
      {
        text: `${session.backendId ?? this.config.defaultBackend} ${shortSessionId(session.acpSessionId)} ${shortPath(session.cwd)}`,
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
          'ACP backend is still running. Send /cancel to stop the current turn.',
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
    this.backendForSession(session).cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    await this.bot.sendMessage({ chatId, text: plainText('Cancel sent.') });
  }

  private async handleStatus(chatId: number): Promise<void> {
    const session = await requireSessionByChat(chatId);
    const backend = this.backendForSession(session);
    await this.bot.sendMessage({
      chatId,
      text: [
        `${plainText('Status:')} ${inlineCode(session.status)}`,
        `${plainText('Backend:')} ${inlineCode(backend.label)} ${plainText('(')}${inlineCode(backend.id)}${plainText(')')}`,
        `${plainText('ACP session:')}\n${codeBlock(session.acpSessionId)}`,
        `${plainText('CWD:')}\n${codeBlock(session.cwd)}`,
      ].join('\n'),
    });
  }

  private async handleSessions(chatId: number): Promise<void> {
    const sessions = await readSessions();
    if (!sessions.length) {
      await this.bot.sendMessage({
        chatId,
        text: plainText('No locally known sessions.'),
      });
      return;
    }
    const lines = sessions.map(
      (session) =>
        `${session.status} ${session.backendId ?? this.config.defaultBackend} ${session.acpSessionId} ${session.cwd}`,
    );
    await this.bot.sendMessage({ chatId, text: codeBlock(lines.join('\n')) });
  }

  private async handleBackends(chatId: number): Promise<void> {
    const lines = [...this.backends.values()].map((backend) => {
      const marker = backend.id === this.config.defaultBackend ? '*' : '-';
      return `${marker} ${backend.id}: ${backend.label}`;
    });
    await this.bot.sendMessage({ chatId, text: codeBlock(lines.join('\n')) });
  }

  private async sendHelp(chatId: number): Promise<void> {
    await this.bot.sendMessage({
      chatId,
      text: codeBlock(
        [
          '/new [backend] [cwd]',
          '/resume',
          '/compact',
          '/load <sessionId> [backend] [cwd]',
          '/status',
          '/sessions',
          '/backends',
          '/cancel',
          '/help',
          '',
          'Regular text is sent to the active ACP backend session.',
        ].join('\n'),
      ),
    });
  }

  private async registerTelegramCommands(): Promise<void> {
    try {
      await this.bot.setMyCommands([
        { command: 'new', description: 'Create a new ACP session' },
        { command: 'resume', description: 'Resume a recent ACP session' },
        { command: 'compact', description: 'Compact the active session' },
        { command: 'load', description: 'Load an ACP session by id' },
        { command: 'status', description: 'Show bridge status' },
        { command: 'sessions', description: 'List local sessions' },
        { command: 'backends', description: 'List configured ACP backends' },
        { command: 'cancel', description: 'Cancel the current turn' },
        { command: 'help', description: 'Show help' },
      ]);
    } catch (error) {
      warn(`Telegram command registration failed: ${errorMessage(error)}`);
    }
  }

  private async handlePrompt(chatId: number, text: string): Promise<void> {
    if (this.activePrompt) {
      await this.updateToolStatus(
        chatId,
        this.toolStatusText ||
          'ACP backend is still running. Send /cancel to stop the current turn.',
      );
      return;
    }

    const session = await requireSessionByChat(chatId);
    await this.ensureSessionLoaded(session);
    const promptText = text;
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
      ...session,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    void this.runPrompt(chatId, session, promptText);
  }

  private async runPrompt(
    chatId: number,
    session: BridgeSession,
    text: string,
  ): Promise<void> {
    try {
      const result = await this.backendForSession(session).prompt({
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

  private async handleCallback(callback: BridgeCallback): Promise<void> {
    if (callback.userId !== this.config.allowedUserId) return;
    const data = callback.data ?? '';
    if (data.startsWith('resume:')) {
      await this.handleResumeCallback(callback, data);
      return;
    }
    if (!data.startsWith('perm:')) return;
    const [, callbackKey, optionIndex] = data.split(':');
    const permission = await takePermission(callbackKey);
    if (!permission) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Permission request not found.',
      });
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
    this.getBackend(permission.backendId ?? this.config.defaultBackend).respond(
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

  private async handleResumeCallback(
    callback: BridgeCallback,
    data: string,
  ): Promise<void> {
    const chatId = callback.chatId;
    if (!chatId) return;
    if (this.activePrompt) {
      await this.bot.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'ACP backend is still running.',
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
    const backend = this.backendForSession(session);
    await this.ensureBackendInitialized(backend);
    await backend.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    this.loadedSessions.add(sessionKey(backend.id, session.acpSessionId));
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
      text: `${plainText(`Resumed ${backend.label} session:`)}\n${codeBlock(session.acpSessionId)}\n${plainText('CWD:')}\n${codeBlock(session.cwd)}`,
    });
  }

  private async handleAcpMessage(
    backendId: string,
    message: unknown,
  ): Promise<void> {
    if (!isRecord(message) || typeof message.method !== 'string') return;
    void this.logAcpEvent({ backendId, ...message });
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
      await this.handlePermissionRequest(backendId, message);
    }
  }

  private async handlePermissionRequest(
    backendId: string,
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
      text: `${plainText('ACP backend requests permission:')}\n${codeBlock(JSON.stringify(isRecord(message.params) ? message.params.toolCall : {}, null, 2).slice(0, 2500))}`,
      replyMarkup: { inline_keyboard: keyboard },
    });
    await savePermission({
      id: requestId,
      callbackKey,
      chatId: this.activeChatId,
      sessionId,
      backendId,
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
    backendId: string,
    acpSessionId: string,
    cwd: string,
    status: BridgeSession['status'],
  ): BridgeSession {
    const now = new Date().toISOString();
    return {
      telegramUserId: this.config.allowedUserId,
      chatId,
      backendId,
      acpSessionId,
      cwd,
      status,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async ensureSessionLoaded(session: BridgeSession): Promise<void> {
    const backend = this.backendForSession(session);
    const key = sessionKey(backend.id, session.acpSessionId);
    if (this.loadedSessions.has(key)) return;
    await this.ensureBackendInitialized(backend);
    await backend.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    this.loadedSessions.add(key);
  }

  private async recentSessions(chatId: number): Promise<BridgeSession[]> {
    const sessions = await readSessions();
    return sessions
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

  private defaultBackend(): AcpBackend {
    return this.getBackend(this.config.defaultBackend);
  }

  private getBackend(backendId: string): AcpBackend {
    const backend = this.backends.get(backendId);
    if (!backend) throw new Error(`Unknown ACP backend: ${backendId}`);
    return backend;
  }

  private backendForSession(session: BridgeSession): AcpBackend {
    return this.getBackend(session.backendId ?? this.config.defaultBackend);
  }

  private async ensureBackendInitialized(backend: AcpBackend): Promise<void> {
    if (this.initializedBackends.has(backend.id)) return;
    backend.start();
    await backend.initialize();
    this.initializedBackends.add(backend.id);
  }

  private parseNewArgs(text: string): { backend: AcpBackend; cwd: string } {
    const [, first, second] = text.split(/\s+/);
    if (first && this.backends.has(first)) {
      return {
        backend: this.getBackend(first),
        cwd: second ?? this.config.defaultCwd,
      };
    }
    return {
      backend: this.defaultBackend(),
      cwd: first ?? this.config.defaultCwd,
    };
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

function shortSessionId(value: string): string {
  return value.length <= 12
    ? value
    : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sessionKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

function shortPath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts.at(-1) ?? value;
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
