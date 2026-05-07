import type { BridgeSessionDto } from '../types';

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
