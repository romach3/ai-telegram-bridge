import type { EventEmitter } from 'node:events';
import type { JsonObject, JsonValue } from './json';

export type AcpRequestId = number | string;

export interface AcpJsonRpcMessage {
  jsonrpc: '2.0';
  id?: AcpRequestId | null;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: AcpJsonRpcError;
}

export interface AcpJsonRpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface AcpInitializeParams extends JsonObject {
  protocolVersion: number;
  clientCapabilities: JsonObject;
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
}

export interface AcpSessionParams extends JsonObject {
  sessionId?: string;
  cwd: string;
  mcpServers: JsonValue[];
}

export interface AcpPromptPart extends JsonObject {
  type: 'text';
  text: string;
}

export interface AcpPromptParams extends JsonObject {
  sessionId: string;
  prompt: AcpPromptPart[];
}

export interface AcpCancelParams extends JsonObject {
  sessionId: string;
}

export interface AcpAgentSessionDto {
  sessionId: string;
}

export interface AcpAgentPromptResultDto {
  stopReason: string;
}

export interface AcpAgentCreateSessionDto {
  cwd: string;
}

export interface AcpAgentLoadSessionDto extends AcpAgentCreateSessionDto {
  sessionId: string;
}

export interface AcpAgentPromptDto {
  sessionId: string;
  text: string;
}

export interface AcpAgentCancelDto {
  sessionId: string;
}

export interface AcpAgent extends EventEmitter {
  id: string;
  label: string;

  start(): void;
  stop(): void;
  initialize(): Promise<void>;
  createSession(input: AcpAgentCreateSessionDto): Promise<AcpAgentSessionDto>;
  loadSession(input: AcpAgentLoadSessionDto): Promise<void>;
  prompt(input: AcpAgentPromptDto): Promise<AcpAgentPromptResultDto>;
  cancel(input: AcpAgentCancelDto): void;
  respond(requestId: AcpRequestId, result: JsonValue): void;
}
