import { randomBytes } from 'node:crypto';
import { requireSessionByScope, upsertSession } from '../../state';
import type { TelegramBotApi } from '../../telegram/bot-api';
import { HELP_LINES } from '../../telegram/commands';
import { codeBlock, inlineCode, plainText } from '../../telegram/markdown';
import { sessionDisplayLabel } from '../../telegram/session-labels';
import type { BridgeConfig, TelegramTextMessageDto } from '../../types';
import { authorizedScope } from '../policy/authorization';
import type { LiveTurnRenderer } from '../rendering/live-turn';
import type { AgentRuntimeService } from '../services/agent-service';
import type { PromptRunner } from '../services/prompt-runner';
import type { SessionRuntimeService } from '../services/session-service';
import type { TurnContextRegistry } from '../state/turn-context-registry';
import type { ConversationScope, ResumeMenu } from '../types';

export class TelegramMessageHandler {
  constructor(
    private readonly bot: TelegramBotApi,
    private readonly config: BridgeConfig,
    private readonly live: LiveTurnRenderer,
    private readonly agents: AgentRuntimeService,
    private readonly sessions: SessionRuntimeService,
    private readonly promptRunner: PromptRunner,
    private readonly contexts: TurnContextRegistry,
    private readonly resumeMenus: Map<string, ResumeMenu>,
  ) {}

  async handle(message: TelegramTextMessageDto): Promise<void> {
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
    if (text.startsWith('/new')) return this.handleNew(scope);
    if (text.startsWith('/resume')) return this.handleResume(scope);
    if (text.startsWith('/compact')) return this.handleCompact(scope);
    if (text.startsWith('/cancel')) return this.handleCancel(scope);
    if (text.startsWith('/status')) return this.handleStatus(scope);
    if (text.startsWith('/agents')) return this.handleAgents(scope);
    if (text.startsWith('/help') || text.startsWith('/start'))
      return this.sendHelp(scope);

    if (text.startsWith('/')) {
      await this.bot.sendMessage({
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
        text: `${plainText('Unknown command:')} ${inlineCode(text.split(/\s+/)[0])}\n${plainText('Send /help.')}`,
      });
      return;
    }

    await this.promptRunner.handlePrompt(scope, text);
  }

  private async handleNew(scope: ConversationScope): Promise<void> {
    const context = this.contexts.get(scope);
    if (context.activePrompt) {
      await this.live.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running in this topic. Send /cancel to stop the current turn.',
      );
      return;
    }
    if (this.agents.size() > 1) {
      const keyboard = this.agents.all().map((agent) => [
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
    await this.createNewSession(scope);
  }

  private async createNewSession(scope: ConversationScope): Promise<void> {
    const agent = this.agents.default();
    await this.sessions.createNew(scope, agent);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: `${plainText(`New ${agent.label} session created.`)}\n${plainText('Send the first task to name it automatically.')}`,
    });
  }

  private async handleResume(scope: ConversationScope): Promise<void> {
    const context = this.contexts.get(scope);
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
    const sessions = await this.sessions.recent();
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
        text: sessionDisplayLabel(session, this.agents.forSession(session)),
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
    const context = this.contexts.get(scope);
    if (context.activePrompt) {
      await this.live.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }
    const session = await requireSessionByScope(scope.scopeId);
    await this.agents.ensureSessionLoaded(session);
    const agent = this.agents.forSession(session);
    this.sessions.prepareContextForPrompt(
      context,
      '/compact',
      agent.id,
      session.acpSessionId,
    );
    await this.live.startTyping(context);
    await upsertSession({
      ...session,
      ...scope,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.contexts.bindAcpSession(agent.id, session.acpSessionId, scope.scopeId);
    void this.promptRunner.run(context, { ...session, ...scope }, '/compact');
  }

  private async handleCancel(scope: ConversationScope): Promise<void> {
    const session = await requireSessionByScope(scope.scopeId);
    const agent = this.agents.forSession(session);
    agent.cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    this.contexts.unbindAcpSession(agent.id, session.acpSessionId);
    const context = this.contexts.get(scope);
    this.sessions.resetActivePromptState(context);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: plainText('Cancel sent.'),
    });
  }

  private async handleStatus(scope: ConversationScope): Promise<void> {
    const session = await requireSessionByScope(scope.scopeId);
    const agent = this.agents.forSession(session);
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
    const lines = this.agents.all().map((agent) => {
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
}
