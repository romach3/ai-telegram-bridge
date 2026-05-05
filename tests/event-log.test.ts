import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendAcpEventLog } from '../src/acp/event-log';

describe('ACP event log', () => {
  it('appends JSONL entries and creates parent directories', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-events-'));
    const filePath = path.join(dir, 'nested', 'events.jsonl');

    await appendAcpEventLog(filePath, { method: 'session/update' });
    await appendAcpEventLog(filePath, { method: 'done' });

    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      message: { method: 'session/update' },
    });
    expect(JSON.parse(lines[1])).toMatchObject({ message: { method: 'done' } });

    await fs.rm(dir, { recursive: true, force: true });
  });
});
