import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSessionByChat,
  readPermissions,
  readSessions,
  requireSessionByChat,
  savePermission,
  takePermission,
  upsertSession,
} from '../src/state';
import type { BridgeSession, PendingPermission } from '../src/types';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-state-'));
  process.env.AI_TELEGRAM_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.AI_TELEGRAM_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('state persistence', () => {
  it('returns empty state when files are missing', async () => {
    await expect(readSessions()).resolves.toEqual([]);
    await expect(readPermissions()).resolves.toEqual([]);
  });

  it('upserts sessions and returns the latest by chat', async () => {
    const older = session({
      acpSessionId: 's1',
      chatId: 10,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = session({
      acpSessionId: 's2',
      chatId: 10,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await upsertSession(older);
    await upsertSession(newer);
    await upsertSession({ ...older, status: 'running' });

    await expect(readSessions()).resolves.toHaveLength(2);
    await expect(getSessionByChat(10)).resolves.toMatchObject({
      acpSessionId: 's2',
    });
  });

  it('throws a clear error when a chat has no session', async () => {
    await expect(requireSessionByChat(404)).rejects.toThrow(
      'No active ACP session. Send /new first.',
    );
  });

  it('saves and takes permissions by callback key or request id', async () => {
    const first = permission({ id: 1, callbackKey: 'abc' });
    const second = permission({ id: 'req-2' });
    await savePermission(first);
    await savePermission(second);

    await expect(takePermission('abc')).resolves.toMatchObject({ id: 1 });
    await expect(takePermission('req-2')).resolves.toMatchObject({
      id: 'req-2',
    });
    await expect(readPermissions()).resolves.toEqual([]);
  });

  it('replaces existing permission with the same callback key', async () => {
    await savePermission(permission({ id: 1, callbackKey: 'same', chatId: 1 }));
    await savePermission(permission({ id: 2, callbackKey: 'same', chatId: 2 }));

    await expect(readPermissions()).resolves.toEqual([
      expect.objectContaining({ id: 2, chatId: 2 }),
    ]);
  });
});

function session(input: Partial<BridgeSession>): BridgeSession {
  return {
    telegramUserId: 1,
    chatId: 1,
    backendId: 'codex',
    acpSessionId: 's',
    cwd: '/tmp',
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}

function permission(input: Partial<PendingPermission>): PendingPermission {
  return {
    id: 1,
    callbackKey: undefined,
    chatId: 1,
    sessionId: 's',
    backendId: 'codex',
    toolCall: null,
    options: [{ optionId: 'allow' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}
