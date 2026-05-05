import path from 'node:path';
import type { BridgeSession, PendingPermission } from './types';
import { fileExists, readJson, writeJsonAtomic } from './utils/files';
import { TOOL_DIR } from './utils/paths';

function dataDir(): string {
  return process.env.AI_TELEGRAM_DATA_DIR ?? path.join(TOOL_DIR, 'data');
}

function sessionsPath(): string {
  return path.join(dataDir(), 'sessions.json');
}

function permissionsPath(): string {
  return path.join(dataDir(), 'pending-permissions.json');
}

export async function readSessions(): Promise<BridgeSession[]> {
  const filePath = sessionsPath();
  if (!(await fileExists(filePath))) return [];
  return readJson<BridgeSession[]>(filePath);
}

export async function writeSessions(sessions: BridgeSession[]): Promise<void> {
  await writeJsonAtomic(sessionsPath(), sessions);
}

export async function upsertSession(session: BridgeSession): Promise<void> {
  const sessions = await readSessions();
  const index = sessions.findIndex(
    (item) =>
      item.acpSessionId === session.acpSessionId &&
      item.backendId === session.backendId,
  );
  if (index === -1) {
    sessions.push(session);
  } else {
    sessions[index] = { ...sessions[index], ...session };
  }
  await writeSessions(sessions);
}

export async function getSessionByChat(
  chatId: number,
): Promise<BridgeSession | undefined> {
  const sessions = await readSessions();
  return sessions
    .filter((item) => item.chatId === chatId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export async function requireSessionByChat(
  chatId: number,
): Promise<BridgeSession> {
  const session = await getSessionByChat(chatId);
  if (!session) {
    throw new Error('No active ACP session. Send /new first.');
  }
  return session;
}

export async function readPermissions(): Promise<PendingPermission[]> {
  const filePath = permissionsPath();
  if (!(await fileExists(filePath))) return [];
  return readJson<PendingPermission[]>(filePath);
}

export async function writePermissions(
  permissions: PendingPermission[],
): Promise<void> {
  await writeJsonAtomic(permissionsPath(), permissions);
}

export async function clearPermissions(): Promise<void> {
  await writePermissions([]);
}

export async function savePermission(
  permission: PendingPermission,
): Promise<void> {
  const permissions = await readPermissions();
  const index = permissions.findIndex((item) => {
    if (permission.callbackKey && item.callbackKey === permission.callbackKey)
      return true;
    return item.id === permission.id;
  });
  if (index === -1) permissions.push(permission);
  else permissions[index] = permission;
  await writePermissions(permissions);
}

export async function takePermission(
  id: number | string,
): Promise<PendingPermission | undefined> {
  const permissions = await readPermissions();
  const index = permissions.findIndex(
    (item) => item.callbackKey === String(id) || String(item.id) === String(id),
  );
  if (index === -1) return undefined;
  const [permission] = permissions.splice(index, 1);
  await writePermissions(permissions);
  return permission;
}

export async function getPermission(
  id: number | string,
): Promise<PendingPermission | undefined> {
  const permissions = await readPermissions();
  return permissions.find(
    (item) => item.callbackKey === String(id) || String(item.id) === String(id),
  );
}

export async function markInterruptedSessionsFailed(): Promise<void> {
  const sessions = await readSessions();
  let changed = false;
  const next = sessions.map((session) => {
    if (session.status !== 'running' && session.status !== 'waiting_permission')
      return session;
    changed = true;
    return {
      ...session,
      status: 'failed' as const,
      updatedAt: new Date().toISOString(),
    };
  });
  if (changed) await writeSessions(next);
}
