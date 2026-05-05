import type {
  AcpBackend,
  AcpCancelParams,
  AcpInitializeParams,
  AcpPromptParams,
  AcpSessionParams,
  BackendCancelInput,
  BackendCreateSessionInput,
  BackendLoadSessionInput,
  BackendPromptInput,
  BackendPromptResult,
  BackendSession,
  BridgeBackendConfig,
} from '../../types';
import { AcpClient } from './json-rpc-client';

export class StdioAcpBackend extends AcpClient implements AcpBackend {
  readonly label: string;

  constructor(
    readonly id: string,
    config: BridgeBackendConfig,
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

  createSession(input: BackendCreateSessionInput): Promise<BackendSession> {
    const params: AcpSessionParams = {
      cwd: input.cwd,
      mcpServers: [],
    };
    return this.request<BackendSession>('session/new', params);
  }

  async loadSession(input: BackendLoadSessionInput): Promise<void> {
    const params: AcpSessionParams = {
      sessionId: input.sessionId,
      cwd: input.cwd,
      mcpServers: [],
    };
    await this.request('session/load', params);
  }

  prompt(input: BackendPromptInput): Promise<BackendPromptResult> {
    const params: AcpPromptParams = {
      sessionId: input.sessionId,
      prompt: [{ type: 'text', text: input.text }],
    };
    return this.request<BackendPromptResult>('session/prompt', params);
  }

  cancel(input: BackendCancelInput): void {
    const params: AcpCancelParams = { sessionId: input.sessionId };
    this.notify('session/cancel', params);
  }
}
