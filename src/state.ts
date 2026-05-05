import path from 'node:path';
import { BridgeSession, PendingPermission } from './types';
import { fileExists, readJson, writeJsonAtomic } from './utils/files';
import { TOOL_DIR } from './utils/paths';

const DATA_DIR = path.join(TOOL_DIR, 'data');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const PERMISSIONS_PATH = path.join(DATA_DIR, 'pending-permissions.json');

export async function readSessions(): Promise<BridgeSession[]> {
  if (!(await fileExists(SESSIONS_PATH))) return [];
  return readJson<BridgeSession[]>(SESSIONS_PATH);
}

export async function writeSessions(sessions: BridgeSession[]): Promise<void> {
  await writeJsonAtomic(SESSIONS_PATH, sessions);
}

export async function upsertSession(session: BridgeSession): Promise<void> {
  const sessions = await readSessions();
  const index = sessions.findIndex((item) => item.acpSessionId === session.acpSessionId && item.backendId === session.backendId);
  if (index === -1) {
    sessions.push(session);
  } else {
    sessions[index] = { ...sessions[index], ...session };
  }
  await writeSessions(sessions);
}

export async function getSessionByChat(chatId: number): Promise<BridgeSession | undefined> {
  const sessions = await readSessions();
  return sessions
    .filter((item) => item.chatId === chatId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export async function requireSessionByChat(chatId: number): Promise<BridgeSession> {
  const session = await getSessionByChat(chatId);
  if (!session) {
    throw new Error('No active ACP session. Send /new first.');
  }
  return session;
}

export async function readPermissions(): Promise<PendingPermission[]> {
  if (!(await fileExists(PERMISSIONS_PATH))) return [];
  return readJson<PendingPermission[]>(PERMISSIONS_PATH);
}

export async function writePermissions(permissions: PendingPermission[]): Promise<void> {
  await writeJsonAtomic(PERMISSIONS_PATH, permissions);
}

export async function savePermission(permission: PendingPermission): Promise<void> {
  const permissions = await readPermissions();
  const index = permissions.findIndex((item) => {
    if (permission.callbackKey && item.callbackKey === permission.callbackKey) return true;
    return item.id === permission.id;
  });
  if (index === -1) permissions.push(permission);
  else permissions[index] = permission;
  await writePermissions(permissions);
}

export async function takePermission(id: number | string): Promise<PendingPermission | undefined> {
  const permissions = await readPermissions();
  const index = permissions.findIndex((item) => item.callbackKey === String(id) || String(item.id) === String(id));
  if (index === -1) return undefined;
  const [permission] = permissions.splice(index, 1);
  await writePermissions(permissions);
  return permission;
}
