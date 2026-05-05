import fs from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject } from '../../types';
import { ensureDir } from '../../utils/files';
import { TOOL_DIR } from '../../utils/paths';

export function defaultAcpEventLogPath(): string {
  return path.join(TOOL_DIR, 'data', 'acp-events.jsonl');
}

export async function appendAcpEventLog(
  filePath: string,
  message: JsonObject,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const entry = {
    ts: new Date().toISOString(),
    message,
  };
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}
