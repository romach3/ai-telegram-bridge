import type { AcpRequestId } from './acp';
import type { JsonValue } from './json';

export type BridgeSessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_permission'
  | 'failed';

export interface BridgeSession {
  telegramUserId: number;
  chatId: number;
  backendId?: string;
  acpSessionId: string;
  cwd: string;
  status: BridgeSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface PendingPermission {
  id: AcpRequestId;
  callbackKey?: string;
  chatId: number;
  sessionId: string;
  backendId?: string;
  messageId?: number;
  toolCall: JsonValue;
  options: PermissionOption[];
  createdAt: string;
}
