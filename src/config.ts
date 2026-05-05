import path from 'node:path';
import { BridgeBackendConfig, BridgeConfig } from './types';
import { fileExists, readJson } from './utils/files';
import { TOOL_DIR } from './utils/paths';

type PartialConfig = Partial<BridgeConfig>;
type AcpConfig = Pick<BridgeConfig, 'defaultCwd' | 'defaultBackend' | 'backends'>;

const DEFAULT_ACP_COMMAND = 'codex-acp';
const DEFAULT_BACKEND = 'codex';
const BOT_CONFIG_PATH = path.join(TOOL_DIR, 'bot.json');

export async function getBridgeConfig(): Promise<BridgeConfig> {
  const fileConfig = (await fileExists(BOT_CONFIG_PATH)) ? await readJson<PartialConfig>(BOT_CONFIG_PATH) : {};
  const botToken = process.env.AI_TELEGRAM_BOT_TOKEN ?? fileConfig.botToken;
  const allowedUserId = Number(process.env.AI_TELEGRAM_ALLOWED_USER_ID ?? fileConfig.allowedUserId);
  const defaultCwd = process.env.AI_TELEGRAM_DEFAULT_CWD ?? fileConfig.defaultCwd ?? process.cwd();
  const defaultAcpCommand = process.env.AI_TELEGRAM_ACP_COMMAND ?? fileConfig.defaultAcpCommand ?? DEFAULT_ACP_COMMAND;
  const defaultBackend = process.env.AI_TELEGRAM_DEFAULT_BACKEND ?? fileConfig.defaultBackend ?? DEFAULT_BACKEND;
  const backends = normalizeBackends(fileConfig.backends, defaultAcpCommand);

  if (!botToken) {
    throw new Error('Missing AI_TELEGRAM_BOT_TOKEN or bot.json botToken');
  }
  if (!Number.isInteger(allowedUserId) || allowedUserId <= 0) {
    throw new Error('Missing AI_TELEGRAM_ALLOWED_USER_ID or bot.json allowedUserId');
  }

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
    acpEventLogPath: process.env.AI_TELEGRAM_ACP_EVENT_LOG ?? fileConfig.acpEventLogPath,
  };
}

export async function getAcpConfig(): Promise<AcpConfig> {
  const fileConfig = (await fileExists(BOT_CONFIG_PATH)) ? await readJson<PartialConfig>(BOT_CONFIG_PATH) : {};
  const defaultAcpCommand = process.env.AI_TELEGRAM_ACP_COMMAND ?? fileConfig.defaultAcpCommand ?? DEFAULT_ACP_COMMAND;
  return {
    defaultCwd: process.env.AI_TELEGRAM_DEFAULT_CWD ?? fileConfig.defaultCwd ?? process.cwd(),
    defaultBackend: process.env.AI_TELEGRAM_DEFAULT_BACKEND ?? fileConfig.defaultBackend ?? DEFAULT_BACKEND,
    backends: normalizeBackends(fileConfig.backends, defaultAcpCommand),
  };
}

function normalizeBackends(backends: Record<string, BridgeBackendConfig> | undefined, defaultAcpCommand: string): Record<string, BridgeBackendConfig> {
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
