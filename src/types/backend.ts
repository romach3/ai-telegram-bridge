import { EventEmitter } from 'node:events';
import { AcpRequestId } from './acp';
import { JsonValue } from './json';

export interface BackendSession {
  sessionId: string;
}

export interface BackendPromptResult {
  stopReason: string;
}

export interface BackendCreateSessionInput {
  cwd: string;
}

export interface BackendLoadSessionInput extends BackendCreateSessionInput {
  sessionId: string;
}

export interface BackendPromptInput {
  sessionId: string;
  text: string;
}

export interface BackendCancelInput {
  sessionId: string;
}

export interface AcpBackend extends EventEmitter {
  id: string;
  label: string;

  start(): void;
  stop(): void;
  initialize(): Promise<void>;
  createSession(input: BackendCreateSessionInput): Promise<BackendSession>;
  loadSession(input: BackendLoadSessionInput): Promise<void>;
  prompt(input: BackendPromptInput): Promise<BackendPromptResult>;
  cancel(input: BackendCancelInput): void;
  respond(requestId: AcpRequestId, result: JsonValue): void;
}
