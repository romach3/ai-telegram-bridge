import type { AcpAgent, BridgeSessionDto } from '../../types';
import { sessionKey } from '../policy/acp-routing';

export class AgentRuntimeService {
  private readonly loadedSessions = new Set<string>();
  private readonly initializedAgents = new Set<string>();
  private readonly lastStderrByAgent = new Map<
    string,
    { text: string; recordedAt: number }
  >();

  constructor(
    private readonly agents: Map<string, AcpAgent>,
    private readonly defaultAgentId: string,
  ) {}

  all(): AcpAgent[] {
    return [...this.agents.values()];
  }

  size(): number {
    return this.agents.size;
  }

  ids(): Set<string> {
    return new Set(this.agents.keys());
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  default(): AcpAgent {
    return this.get(this.defaultAgentId);
  }

  get(agentId: string): AcpAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown ACP agent: ${agentId}`);
    return agent;
  }

  forSession(session: BridgeSessionDto): AcpAgent {
    return this.get(session.agentId ?? this.defaultAgentId);
  }

  async ensureInitialized(agent: AcpAgent): Promise<void> {
    if (this.initializedAgents.has(agent.id)) return;
    agent.start();
    await agent.initialize();
    this.initializedAgents.add(agent.id);
  }

  recordStderr(agentId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.lastStderrByAgent.set(agentId, {
      text: trimmed,
      recordedAt: Date.now(),
    });
  }

  recentErrorHint(agentId: string, since: number): string | undefined {
    const entry = this.lastStderrByAgent.get(agentId);
    if (!entry || entry.recordedAt < since) return undefined;
    if (!isActionableAcpStderr(entry.text)) return undefined;
    return entry.text;
  }

  async createSession(agent: AcpAgent, cwd: string): Promise<string> {
    await this.ensureInitialized(agent);
    const result = await agent.createSession({ cwd });
    this.loadedSessions.add(sessionKey(agent.id, result.sessionId));
    return result.sessionId;
  }

  async ensureSessionLoaded(session: BridgeSessionDto): Promise<void> {
    const agent = this.forSession(session);
    const key = sessionKey(agent.id, session.acpSessionId);
    if (this.loadedSessions.has(key)) return;
    await this.ensureInitialized(agent);
    await agent.loadSession({
      sessionId: session.acpSessionId,
      cwd: session.cwd,
    });
    this.loadedSessions.add(key);
  }
}

function isActionableAcpStderr(text: string): boolean {
  return /ServerOverloaded|Selected model is at capacity|rate limit|capacity|overloaded/i.test(
    text,
  );
}
