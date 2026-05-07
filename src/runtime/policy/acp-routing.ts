export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}
