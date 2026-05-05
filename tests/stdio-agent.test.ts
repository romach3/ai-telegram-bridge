import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StdioAcpAgent } from '../src/acp/stdio-agent';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dirname, 'fixtures', 'fake-acp.mjs');

describe('StdioAcpAgent', () => {
  it('maps bridge operations to ACP JSON-RPC methods', async () => {
    const agent = new StdioAcpAgent(
      'codex',
      {
        command: process.execPath,
        args: [fixturePath],
      },
      process.cwd(),
    );

    await expect(agent.initialize()).resolves.toBeUndefined();
    await expect(agent.createSession({ cwd: '/repo' })).resolves.toEqual({
      sessionId: 'fake-session',
    });
    await expect(
      agent.prompt({ sessionId: 's1', text: 'hello' }),
    ).resolves.toEqual({
      stopReason: 'end_turn',
    });
    await expect(
      agent.loadSession({ sessionId: 's1', cwd: '/repo' }),
    ).resolves.toBeUndefined();

    agent.cancel({ sessionId: 's1' });
    agent.stop();
  });
});
