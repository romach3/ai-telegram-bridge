import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AcpClient } from '../src/backend/acp/json-rpc-client';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dirname, 'fixtures', 'fake-acp.mjs');

describe('AcpClient', () => {
  it('correlates responses, emits notifications, stderr, and raw lines', async () => {
    const client = new AcpClient(process.execPath, process.cwd(), [
      fixturePath,
    ]);
    const messages: unknown[] = [];
    const raw: string[] = [];
    const stderr: string[] = [];
    client.on('message', (message) => messages.push(message));
    client.on('raw', (line) => raw.push(String(line)));
    client.on('stderr', (line) => stderr.push(String(line)));

    const response = await client.request<{ method: string; params: unknown }>(
      'echo',
      { ok: true },
    );

    expect(response).toEqual({ method: 'echo', params: { ok: true } });
    expect(raw).toContain('not json');
    expect(messages).toEqual([
      expect.objectContaining({ method: 'session/update' }),
    ]);
    expect(stderr.join('')).toContain('fake stderr');
    client.stop();
  });

  it('rejects JSON-RPC errors', async () => {
    const client = new AcpClient(process.execPath, process.cwd(), [
      fixturePath,
    ]);
    await expect(client.request('fail')).rejects.toThrow('failed as requested');
    client.stop();
  });
});
