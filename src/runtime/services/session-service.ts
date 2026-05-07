import {
  getSessionByScope,
  readSessions,
  replaceSessions,
  upsertSession,
} from '../../state';
import { labelFromPrompt } from '../../telegram/session-labels';
import type { AcpAgent, BridgeConfig, BridgeSessionDto } from '../../types';
import { normalizeSessions } from '../policy/sessions';
import type { LiveTurnRenderer } from '../rendering/live-turn';
import type { ConversationScope, TurnContext } from '../types';
import type { AgentRuntimeService } from './agent-service';

export class SessionRuntimeService {
  constructor(
    private readonly config: BridgeConfig,
    private readonly agents: AgentRuntimeService,
    private readonly live: LiveTurnRenderer,
  ) {}

  make(
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

  async createNew(
    scope: ConversationScope,
    agent: AcpAgent,
  ): Promise<BridgeSessionDto> {
    const cwd = this.config.defaultCwd;
    const acpSessionId = await this.agents.createSession(agent, cwd);
    const session = this.make(scope, agent.id, acpSessionId, cwd, 'idle');
    await upsertSession(session);
    return session;
  }

  async recent(): Promise<BridgeSessionDto[]> {
    const sessions = await readSessions();
    const normalized = normalizeSessions(
      sessions,
      this.config.defaultAgent,
      this.agents.ids(),
    );
    if (normalized.changed) await replaceSessions(normalized.sessions);
    return normalized.sessions
      .filter((session) => session.telegramUserId === this.config.allowedUserId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async getOrCreateForScope(
    scope: ConversationScope,
  ): Promise<BridgeSessionDto> {
    const existing = await getSessionByScope(scope.scopeId);
    if (existing) return existing;
    return this.createNew(scope, this.agents.default());
  }

  withPromptLabel(
    session: BridgeSessionDto,
    promptText: string,
  ): BridgeSessionDto {
    return session.label
      ? session
      : {
          ...session,
          label: labelFromPrompt(promptText),
        };
  }

  prepareContextForPrompt(
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
    this.live.resetTechnicalText(context);
    context.sawToolEvent = false;
    context.activeToolCallIds = new Set();
  }

  resetActivePromptState(context: TurnContext): void {
    this.live.stopTyping(context);
    this.live.releaseToolStatus(context);
    context.pendingPromptText = '';
    context.pendingUserText = '';
    context.collectingCurrentPrompt = false;
    context.preToolAgentBuffer = '';
    this.live.resetTechnicalText(context);
    context.sawToolEvent = false;
    context.activeToolCallIds = new Set();
    context.activePrompt = false;
    context.activeAgentId = undefined;
    context.activeAcpSessionId = undefined;
  }
}
