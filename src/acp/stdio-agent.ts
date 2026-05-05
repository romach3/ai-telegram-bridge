import type {
  AcpAgent,
  AcpAgentCancelDto,
  AcpAgentConfig,
  AcpAgentCreateSessionDto,
  AcpAgentLoadSessionDto,
  AcpAgentPromptDto,
  AcpAgentPromptResultDto,
  AcpAgentSessionDto,
  AcpCancelParams,
  AcpInitializeParams,
  AcpPromptParams,
  AcpSessionParams,
} from '../types';
import { AcpClient } from './json-rpc-client';

interface AcpAgentRuntimeConfig {
  defaultCwd: string;
  defaultAgent: string;
  agents: Record<string, AcpAgentConfig>;
}

export class StdioAcpAgent extends AcpClient implements AcpAgent {
  readonly label: string;

  constructor(
    readonly id: string,
    config: AcpAgentConfig,
    defaultCwd: string,
  ) {
    super(config.command, config.cwd ?? defaultCwd, config.args ?? []);
    this.label = config.label ?? id;
  }

  async initialize(): Promise<void> {
    const params: AcpInitializeParams = {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'ai-telegram-bridge',
        title: 'AI Telegram Bridge',
        version: '0.1.0',
      },
    };
    await this.request('initialize', params);
  }

  createSession(input: AcpAgentCreateSessionDto): Promise<AcpAgentSessionDto> {
    const params: AcpSessionParams = {
      cwd: input.cwd,
      mcpServers: [],
    };
    return this.request<AcpAgentSessionDto>('session/new', params);
  }

  async loadSession(input: AcpAgentLoadSessionDto): Promise<void> {
    const params: AcpSessionParams = {
      sessionId: input.sessionId,
      cwd: input.cwd,
      mcpServers: [],
    };
    await this.request('session/load', params);
  }

  prompt(input: AcpAgentPromptDto): Promise<AcpAgentPromptResultDto> {
    const params: AcpPromptParams = {
      sessionId: input.sessionId,
      prompt: [{ type: 'text', text: input.text }],
    };
    return this.request<AcpAgentPromptResultDto>('session/prompt', params);
  }

  cancel(input: AcpAgentCancelDto): void {
    const params: AcpCancelParams = { sessionId: input.sessionId };
    this.notify('session/cancel', params);
  }
}

export function createAcpAgents(
  config: AcpAgentRuntimeConfig,
): Map<string, AcpAgent> {
  const agents = new Map<string, AcpAgent>();
  for (const [id, agentConfig] of Object.entries(config.agents)) {
    agents.set(id, new StdioAcpAgent(id, agentConfig, config.defaultCwd));
  }
  if (!agents.has(config.defaultAgent)) {
    throw new Error(`Default agent is not configured: ${config.defaultAgent}`);
  }
  return agents;
}
