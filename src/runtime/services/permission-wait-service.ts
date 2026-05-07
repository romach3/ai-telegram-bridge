import { getSessionByScope, readPermissions, upsertSession } from '../../state';
import { scopeFromTelegramInput } from '../policy/authorization';
import type { ConversationScope, TurnContext } from '../types';
import type { AgentRuntimeService } from './agent-service';
import type { SessionRuntimeService } from './session-service';

export class PermissionWaitService {
  constructor(
    private readonly agents: AgentRuntimeService,
    private readonly sessions: SessionRuntimeService,
  ) {}

  async recoverStaleWait(
    scope: ConversationScope,
    context: TurnContext,
  ): Promise<void> {
    const session = await getSessionByScope(scope.scopeId);
    if (session?.status !== 'waiting_permission') return;
    if (await this.hasPendingForScope(scope.scopeId)) return;
    this.agents.forSession(session).cancel({ sessionId: session.acpSessionId });
    await upsertSession({
      ...session,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
    this.sessions.resetActivePromptState(context);
  }

  async markStaleWait(scope: ConversationScope): Promise<void> {
    const session = await getSessionByScope(scope.scopeId);
    if (session?.status !== 'waiting_permission') return;
    if (await this.hasPendingForScope(scope.scopeId)) return;
    await upsertSession({
      ...session,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
  }

  async hasPendingForScope(scopeId: string): Promise<boolean> {
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
}
