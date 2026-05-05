import path from 'node:path';
import type { AcpAgent, BridgeSessionDto } from '../types';

const MAX_SESSION_LABEL_LENGTH = 80;

export function labelFromPrompt(prompt: string): string {
  return truncateUnicode(normalizeLabel(prompt), MAX_SESSION_LABEL_LENGTH);
}

export function sessionDisplayLabel(
  session: BridgeSessionDto,
  agent: Pick<AcpAgent, 'id' | 'label'>,
): string {
  const label = normalizeLabel(session.label ?? '');
  if (label) return label;
  return `${agent.label} · ${workspaceName(session.cwd)} · ${shortSessionId(session.acpSessionId)}`;
}

export function workspaceName(cwd: string): string {
  return path.basename(cwd) || cwd;
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateUnicode(value: string, maxLength: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  return `${chars.slice(0, maxLength - 3).join('')}...`;
}

function shortSessionId(value: string): string {
  return value.length <= 12
    ? value
    : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
