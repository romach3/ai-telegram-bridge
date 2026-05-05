import { JsonObject, JsonValue } from './json';

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
