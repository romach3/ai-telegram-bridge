import path from 'node:path';
import type { BridgeBackendConfig, BridgeConfig } from './types';
import { fileExists, readJson } from './utils/files';
import { TOOL_DIR } from './utils/paths';

type PartialConfig = Partial<BridgeConfig>;
type AcpConfig = Pick<
  BridgeConfig,
  'defaultCwd' | 'defaultBackend' | 'backends'
>;

const DEFAULT_ACP_COMMAND = 'codex-acp';
const DEFAULT_BACKEND = 'codex';
function botConfigPath(): string {
  return process.env.AI_TELEGRAM_CONFIG_PATH ?? path.join(TOOL_DIR, 'bot.json');
}

export async function getBridgeConfig(): Promise<BridgeConfig> {
  const configPath = botConfigPath();
  const fileConfig = (await fileExists(configPath))
    ? await readJson<PartialConfig>(configPath)
    : {};
  const botToken = process.env.AI_TELEGRAM_BOT_TOKEN ?? fileConfig.botToken;
  const allowedUserId = Number(
    process.env.AI_TELEGRAM_ALLOWED_USER_ID ?? fileConfig.allowedUserId,
  );
  const defaultCwd =
    process.env.AI_TELEGRAM_DEFAULT_CWD ??
    fileConfig.defaultCwd ??
    process.cwd();
  const defaultAcpCommand =
    process.env.AI_TELEGRAM_ACP_COMMAND ??
    fileConfig.defaultAcpCommand ??
    DEFAULT_ACP_COMMAND;
  const defaultBackend =
    process.env.AI_TELEGRAM_DEFAULT_BACKEND ??
    fileConfig.defaultBackend ??
    DEFAULT_BACKEND;
  const backends = normalizeBackends(fileConfig.backends, defaultAcpCommand);

  if (!botToken) {
    throw new Error('Missing AI_TELEGRAM_BOT_TOKEN or bot.json botToken');
  }
  if (!Number.isInteger(allowedUserId) || allowedUserId <= 0) {
    throw new Error(
      'Missing AI_TELEGRAM_ALLOWED_USER_ID or bot.json allowedUserId',
    );
  }
  validateConfig({
    defaultBackend,
    backends,
    pollTimeoutSeconds: Number(fileConfig.pollTimeoutSeconds ?? 25),
    flushIntervalMs: Number(fileConfig.flushIntervalMs ?? 1200),
    liveEditIntervalMs: Number(fileConfig.liveEditIntervalMs ?? 2500),
  });

  return {
    botToken,
    allowedUserId,
    defaultCwd,
    defaultBackend,
    backends,
    defaultAcpCommand,
    pollTimeoutSeconds: Number(fileConfig.pollTimeoutSeconds ?? 25),
    flushIntervalMs: Number(fileConfig.flushIntervalMs ?? 1200),
    liveEditIntervalMs: Number(fileConfig.liveEditIntervalMs ?? 2500),
    acpEventLogPath:
      process.env.AI_TELEGRAM_ACP_EVENT_LOG ?? fileConfig.acpEventLogPath,
  };
}

export async function getAcpConfig(): Promise<AcpConfig> {
  const configPath = botConfigPath();
  const fileConfig = (await fileExists(configPath))
    ? await readJson<PartialConfig>(configPath)
    : {};
  const defaultAcpCommand =
    process.env.AI_TELEGRAM_ACP_COMMAND ??
    fileConfig.defaultAcpCommand ??
    DEFAULT_ACP_COMMAND;
  const backends = normalizeBackends(fileConfig.backends, defaultAcpCommand);
  validateConfig({
    defaultBackend:
      process.env.AI_TELEGRAM_DEFAULT_BACKEND ??
      fileConfig.defaultBackend ??
      DEFAULT_BACKEND,
    backends,
  });
  return {
    defaultCwd:
      process.env.AI_TELEGRAM_DEFAULT_CWD ??
      fileConfig.defaultCwd ??
      process.cwd(),
    defaultBackend:
      process.env.AI_TELEGRAM_DEFAULT_BACKEND ??
      fileConfig.defaultBackend ??
      DEFAULT_BACKEND,
    backends,
  };
}

function normalizeBackends(
  backends: Record<string, BridgeBackendConfig> | undefined,
  defaultAcpCommand: string,
): Record<string, BridgeBackendConfig> {
  if (backends && Object.keys(backends).length > 0) return backends;
  return {
    [DEFAULT_BACKEND]: {
      type: 'stdio-acp',
      label: 'Codex',
      command: defaultAcpCommand,
      args: [],
    },
  };
}

function validateConfig(input: {
  defaultBackend: string;
  backends: Record<string, BridgeBackendConfig>;
  pollTimeoutSeconds?: number;
  flushIntervalMs?: number;
  liveEditIntervalMs?: number;
}): void {
  if (!Object.keys(input.backends).length) {
    throw new Error('At least one backend must be configured');
  }
  if (!input.backends[input.defaultBackend]) {
    throw new Error(
      `Default backend is not configured: ${input.defaultBackend}`,
    );
  }
  for (const [backendId, backend] of Object.entries(input.backends)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(backendId)) {
      throw new Error(`Invalid backend id: ${backendId}`);
    }
    if (backend.type !== 'stdio-acp') {
      throw new Error(
        `Unsupported backend type for ${backendId}: ${backend.type}`,
      );
    }
    if (!backend.command?.trim()) {
      throw new Error(`Missing command for backend: ${backendId}`);
    }
  }
  for (const [name, value] of [
    ['pollTimeoutSeconds', input.pollTimeoutSeconds],
    ['flushIntervalMs', input.flushIntervalMs],
    ['liveEditIntervalMs', input.liveEditIntervalMs],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid ${name}: ${value}`);
    }
  }
}
