import { describe, expect, it } from 'vitest';
import { createBackends } from '../src/backend/registry';

describe('backend registry', () => {
  it('creates configured stdio ACP backends', () => {
    const backends = createBackends({
      botToken: 'token',
      allowedUserId: 1,
      defaultCwd: '/repo',
      defaultBackend: 'codex',
      defaultAcpCommand: 'codex-acp',
      pollTimeoutSeconds: 1,
      flushIntervalMs: 1,
      liveEditIntervalMs: 1,
      backends: {
        codex: { type: 'stdio-acp', label: 'Codex', command: 'codex-acp' },
      },
    });

    expect(backends.get('codex')).toMatchObject({
      id: 'codex',
      label: 'Codex',
    });
  });

  it('rejects missing default backend', () => {
    expect(() =>
      createBackends({
        botToken: 'token',
        allowedUserId: 1,
        defaultCwd: '/repo',
        defaultBackend: 'missing',
        defaultAcpCommand: 'codex-acp',
        pollTimeoutSeconds: 1,
        flushIntervalMs: 1,
        liveEditIntervalMs: 1,
        backends: {
          codex: { type: 'stdio-acp', command: 'codex-acp' },
        },
      }),
    ).toThrow('Default backend is not configured: missing');
  });
});
