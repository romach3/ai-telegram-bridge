import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAcpConfig, getBridgeConfig } from '../src/config';

const ENV_KEYS = [
  'AI_TELEGRAM_CONFIG_PATH',
  'AI_TELEGRAM_BOT_TOKEN',
  'AI_TELEGRAM_ALLOWED_USER_ID',
  'AI_TELEGRAM_DEFAULT_CWD',
  'AI_TELEGRAM_ACP_COMMAND',
  'AI_TELEGRAM_DEFAULT_BACKEND',
  'AI_TELEGRAM_ACP_EVENT_LOG',
];

let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-config-'));
  for (const key of ENV_KEYS) delete process.env[key];
  configPath = path.join(tmpDir, 'bot.json');
  process.env.AI_TELEGRAM_CONFIG_PATH = configPath;
});

afterEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('config loading', () => {
  it('loads required bridge config from env and creates default backend', async () => {
    process.env.AI_TELEGRAM_BOT_TOKEN = 'token';
    process.env.AI_TELEGRAM_ALLOWED_USER_ID = '42';
    process.env.AI_TELEGRAM_DEFAULT_CWD = '/workspace';
    process.env.AI_TELEGRAM_ACP_COMMAND = 'custom-acp';
    process.env.AI_TELEGRAM_ACP_EVENT_LOG = '/tmp/events.jsonl';

    await expect(getBridgeConfig()).resolves.toMatchObject({
      botToken: 'token',
      allowedUserId: 42,
      defaultCwd: '/workspace',
      defaultBackend: 'codex',
      acpEventLogPath: '/tmp/events.jsonl',
      backends: {
        codex: {
          type: 'stdio-acp',
          command: 'custom-acp',
        },
      },
    });
  });

  it('loads backend config from bot.json', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        botToken: 'file-token',
        allowedUserId: 7,
        defaultCwd: '/repo',
        defaultBackend: 'other',
        backends: {
          other: {
            type: 'stdio-acp',
            label: 'Other',
            command: 'other-acp',
            args: ['--acp'],
          },
        },
      }),
    );

    await expect(getBridgeConfig()).resolves.toMatchObject({
      botToken: 'file-token',
      allowedUserId: 7,
      defaultBackend: 'other',
      backends: {
        other: {
          command: 'other-acp',
          args: ['--acp'],
        },
      },
    });
  });

  it('rejects missing token or allowed user id', async () => {
    await expect(getBridgeConfig()).rejects.toThrow(
      'Missing AI_TELEGRAM_BOT_TOKEN',
    );
    process.env.AI_TELEGRAM_BOT_TOKEN = 'token';
    await expect(getBridgeConfig()).rejects.toThrow(
      'Missing AI_TELEGRAM_ALLOWED_USER_ID',
    );
  });

  it('rejects a default backend that is not configured', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        botToken: 'token',
        allowedUserId: 7,
        defaultBackend: 'missing',
        backends: {
          codex: {
            type: 'stdio-acp',
            command: 'codex-acp',
          },
        },
      }),
    );

    await expect(getBridgeConfig()).rejects.toThrow(
      'Default backend is not configured: missing',
    );
  });

  it('rejects invalid backend ids and empty commands', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        botToken: 'token',
        allowedUserId: 7,
        defaultBackend: 'bad id',
        backends: {
          'bad id': {
            type: 'stdio-acp',
            command: 'codex-acp',
          },
        },
      }),
    );

    await expect(getBridgeConfig()).rejects.toThrow(
      'Invalid backend id: bad id',
    );

    await fs.writeFile(
      configPath,
      JSON.stringify({
        botToken: 'token',
        allowedUserId: 7,
        defaultBackend: 'codex',
        backends: {
          codex: {
            type: 'stdio-acp',
            command: '',
          },
        },
      }),
    );

    await expect(getBridgeConfig()).rejects.toThrow(
      'Missing command for backend: codex',
    );
  });

  it('rejects invalid timing values', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        botToken: 'token',
        allowedUserId: 7,
        pollTimeoutSeconds: 0,
      }),
    );

    await expect(getBridgeConfig()).rejects.toThrow(
      'Invalid pollTimeoutSeconds: 0',
    );
  });

  it('returns ACP-only config without bot credentials', async () => {
    process.env.AI_TELEGRAM_DEFAULT_CWD = '/repo';
    await expect(getAcpConfig()).resolves.toMatchObject({
      defaultCwd: '/repo',
      defaultBackend: 'codex',
    });
  });
});
