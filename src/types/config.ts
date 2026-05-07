export interface AcpAgentConfig {
  label?: string;
  command: string;
  args?: string[];
  cwd?: string;
}

export interface AllowedChatConfig {
  chatId: number;
  topics: 'all';
}

export interface BridgeConfig {
  botToken: string;
  allowedUserId: number;
  allowedChats: AllowedChatConfig[];
  defaultCwd: string;
  defaultAgent: string;
  agents: Record<string, AcpAgentConfig>;
  pollTimeoutSeconds: number;
  flushIntervalMs: number;
  liveEditIntervalMs: number;
  acpEventLogPath?: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pendingUpdateCount?: number;
}
