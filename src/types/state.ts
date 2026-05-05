import type { AcpRequestId } from './acp';
import type { JsonValue } from './json';

export type BridgeSessionStatusDto =
  | 'idle'
  | 'running'
  | 'waiting_permission'
  | 'failed';

export interface BridgeSessionDto {
  telegramUserId: number;
  chatId: number;
  agentId?: string;
  acpSessionId: string;
  cwd: string;
  label?: string;
  status: BridgeSessionStatusDto;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionOptionDto {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface PendingPermissionDto {
  id: AcpRequestId;
  callbackKey?: string;
  chatId: number;
  sessionId: string;
  agentId?: string;
  messageId?: number;
  toolCall: JsonValue;
  options: PermissionOptionDto[];
  createdAt: string;
}
