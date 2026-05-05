export type BackendType = 'stdio-acp';

export interface BridgeBackendConfig {
  type: BackendType;
  label?: string;
  command: string;
  args?: string[];
  cwd?: string;
}

export interface BridgeConfig {
  botToken: string;
  allowedUserId: number;
  defaultCwd: string;
  defaultBackend: string;
  backends: Record<string, BridgeBackendConfig>;
  defaultAcpCommand: string;
  pollTimeoutSeconds: number;
  flushIntervalMs: number;
  liveEditIntervalMs: number;
  acpEventLogPath?: string;
}
