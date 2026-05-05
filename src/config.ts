import path from 'node:path';
import type { AcpAgentConfig, BridgeConfig } from './types';
import { fileExists, readJson } from './utils/files';
import { TOOL_DIR } from './utils/paths';

type PartialConfig = Partial<BridgeConfig>;
type AcpConfig = Pick<BridgeConfig, 'defaultCwd' | 'defaultAgent' | 'agents'>;

const DEFAULT_ACP_COMMAND = 'codex-acp';
const DEFAULT_AGENT = 'codex';
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
  const acpCommand = process.env.AI_TELEGRAM_ACP_COMMAND ?? DEFAULT_ACP_COMMAND;
  const defaultAgent =
    process.env.AI_TELEGRAM_DEFAULT_AGENT ??
    fileConfig.defaultAgent ??
    DEFAULT_AGENT;
  const agents = normalizeAgents(fileConfig.agents, acpCommand);

  if (!botToken) {
    throw new Error('Missing AI_TELEGRAM_BOT_TOKEN or bot.json botToken');
  }
  if (!Number.isInteger(allowedUserId) || allowedUserId <= 0) {
    throw new Error(
      'Missing AI_TELEGRAM_ALLOWED_USER_ID or bot.json allowedUserId',
    );
  }
  validateConfig({
    defaultAgent,
    agents,
    pollTimeoutSeconds: Number(fileConfig.pollTimeoutSeconds ?? 25),
    flushIntervalMs: Number(fileConfig.flushIntervalMs ?? 1200),
    liveEditIntervalMs: Number(fileConfig.liveEditIntervalMs ?? 2500),
  });

  return {
    botToken,
    allowedUserId,
    defaultCwd,
    defaultAgent,
    agents,
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
  const acpCommand = process.env.AI_TELEGRAM_ACP_COMMAND ?? DEFAULT_ACP_COMMAND;
  const agents = normalizeAgents(fileConfig.agents, acpCommand);
  validateConfig({
    defaultAgent:
      process.env.AI_TELEGRAM_DEFAULT_AGENT ??
      fileConfig.defaultAgent ??
      DEFAULT_AGENT,
    agents,
  });
  return {
    defaultCwd:
      process.env.AI_TELEGRAM_DEFAULT_CWD ??
      fileConfig.defaultCwd ??
      process.cwd(),
    defaultAgent:
      process.env.AI_TELEGRAM_DEFAULT_AGENT ??
      fileConfig.defaultAgent ??
      DEFAULT_AGENT,
    agents,
  };
}

function normalizeAgents(
  agents: Record<string, AcpAgentConfig> | undefined,
  acpCommand: string,
): Record<string, AcpAgentConfig> {
  if (agents && Object.keys(agents).length > 0) return agents;
  return {
    [DEFAULT_AGENT]: {
      label: 'Codex',
      command: acpCommand,
      args: [],
    },
  };
}

function validateConfig(input: {
  defaultAgent: string;
  agents: Record<string, AcpAgentConfig>;
  pollTimeoutSeconds?: number;
  flushIntervalMs?: number;
  liveEditIntervalMs?: number;
}): void {
  if (!Object.keys(input.agents).length) {
    throw new Error('At least one agent must be configured');
  }
  if (!input.agents[input.defaultAgent]) {
    throw new Error(`Default agent is not configured: ${input.defaultAgent}`);
  }
  for (const [agentId, agent] of Object.entries(input.agents)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      throw new Error(`Invalid agent id: ${agentId}`);
    }
    if (!agent.command?.trim()) {
      throw new Error(`Missing command for agent: ${agentId}`);
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
