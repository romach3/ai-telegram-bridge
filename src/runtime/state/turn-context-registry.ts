import { warn } from '../../utils/logger';
import { sessionKey } from '../policy/acp-routing';
import type { ConversationScope, TurnContext } from '../types';

export class TurnContextRegistry {
  private readonly contexts = new Map<string, TurnContext>();
  private readonly scopeByAcpSession = new Map<string, string>();

  get(scope: ConversationScope): TurnContext {
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

  bindAcpSession(agentId: string, acpSessionId: string, scopeId: string): void {
    this.scopeByAcpSession.set(sessionKey(agentId, acpSessionId), scopeId);
  }

  unbindAcpSession(agentId: string, acpSessionId: string): void {
    this.scopeByAcpSession.delete(sessionKey(agentId, acpSessionId));
  }

  forAcpUpdate(
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
}
