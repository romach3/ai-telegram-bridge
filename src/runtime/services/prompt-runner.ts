import { upsertSession } from '../../state';
import type { TelegramBotApi } from '../../telegram/bot-api';
import { inlineCode, plainText } from '../../telegram/markdown';
import type { BridgeSessionDto } from '../../types';
import type { LiveTurnRenderer } from '../rendering/live-turn';
import { delay } from '../rendering/text';
import type { TurnContextRegistry } from '../state/turn-context-registry';
import type { ConversationScope, TurnContext } from '../types';
import type { AgentRuntimeService } from './agent-service';
import type { PermissionWaitService } from './permission-wait-service';
import type { SessionRuntimeService } from './session-service';

export class PromptRunner {
  constructor(
    private readonly bot: TelegramBotApi,
    private readonly live: LiveTurnRenderer,
    private readonly agents: AgentRuntimeService,
    private readonly sessions: SessionRuntimeService,
    private readonly permissionWait: PermissionWaitService,
    private readonly contexts: TurnContextRegistry,
  ) {}

  async handlePrompt(scope: ConversationScope, text: string): Promise<void> {
    const context = this.contexts.get(scope);
    await this.permissionWait.recoverStaleWait(scope, context);
    if (context.activePrompt) {
      await this.live.updateToolStatus(
        context,
        context.toolStatusText ||
          'ACP agent is still running. Send /cancel to stop the current turn.',
      );
      return;
    }

    const session = await this.sessions.getOrCreateForScope(scope);
    await this.agents.ensureSessionLoaded(session);
    const promptText = text;
    const nextSession = this.sessions.withPromptLabel(session, promptText);
    const agent = this.agents.forSession(nextSession);
    this.sessions.prepareContextForPrompt(
      context,
      promptText,
      agent.id,
      nextSession.acpSessionId,
    );
    await this.live.startTyping(context);
    await upsertSession({
      ...nextSession,
      ...scope,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.contexts.bindAcpSession(
      agent.id,
      nextSession.acpSessionId,
      scope.scopeId,
    );
    void this.run(context, { ...nextSession, ...scope }, promptText);
  }

  async run(
    context: TurnContext,
    session: BridgeSessionDto,
    text: string,
  ): Promise<void> {
    const agent = this.agents.forSession(session);
    const startedAt = Date.now();
    try {
      const result = await agent.prompt({
        sessionId: session.acpSessionId,
        text,
      });
      await delay(1000);
      this.live.stopTyping(context);
      await this.live.sendFinalAnswer(context);
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
      this.live.stopTyping(context);
      await this.live.sendFinalAnswer(context);
      await upsertSession({
        ...session,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      });
      if (context.toolStatusMessageId)
        await this.live.finishToolStatus(context, 'Failed.');
      const message = this.formatAcpError(agent.id, error, startedAt, context);
      await this.bot.sendMessage({
        chatId: context.chatId,
        messageThreadId: context.messageThreadId,
        text: plainText(`ACP error: ${message}`),
      });
    } finally {
      this.contexts.unbindAcpSession(agent.id, session.acpSessionId);
      this.sessions.resetActivePromptState(context);
    }
  }

  private formatAcpError(
    agentId: string,
    error: unknown,
    startedAt: number,
    context: TurnContext,
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    const hint = this.agents.recentErrorHint(agentId, startedAt);
    if (!hint) return message;
    const normalizedHint = normalizeAcpStderr(hint);
    if (/^internal error$/i.test(message)) return normalizedHint;
    if (
      !context.buffer.trim() &&
      /ServerOverloaded|capacity|overloaded/i.test(hint)
    ) {
      return normalizedHint;
    }
    return `${message}. ${normalizedHint}`;
  }
}

function normalizeAcpStderr(text: string): string {
  const capacityMatch = text.match(
    /Selected model is at capacity\. Please try a different model\./i,
  );
  if (capacityMatch) return capacityMatch[0];
  return text.replace(/^\S+\s+ERROR\s+[^:]+:\s*/i, '').trim();
}
