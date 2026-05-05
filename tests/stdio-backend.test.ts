import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StdioAcpBackend } from '../src/backend/acp/stdio-backend';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dirname, 'fixtures', 'fake-acp.mjs');

describe('StdioAcpBackend', () => {
  it('maps bridge operations to ACP JSON-RPC methods', async () => {
    const backend = new StdioAcpBackend(
      'codex',
      {
        type: 'stdio-acp',
        command: process.execPath,
        args: [fixturePath],
      },
      process.cwd(),
    );

    await expect(backend.initialize()).resolves.toBeUndefined();
    await expect(backend.createSession({ cwd: '/repo' })).resolves.toEqual({
      sessionId: 'fake-session',
    });
    await expect(
      backend.prompt({ sessionId: 's1', text: 'hello' }),
    ).resolves.toEqual({
      stopReason: 'end_turn',
    });
    await expect(
      backend.loadSession({ sessionId: 's1', cwd: '/repo' }),
    ).resolves.toBeUndefined();

    backend.cancel({ sessionId: 's1' });
    backend.stop();
  });
});
