import { isRecord } from '../../acp/events';
import { codeBlock, inlineCode, plainText } from '../../telegram/markdown';
import type { JsonValue } from '../../types';

const PERMISSION_TTL_MS = 15 * 60 * 1000;

export function isExpiredPermission(input: { createdAt: string }): boolean {
  const createdAt = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt > PERMISSION_TTL_MS;
}

export function formatPermissionRequestText(
  params: JsonValue | undefined,
): string {
  const toolCall = isRecord(params) ? params.toolCall : undefined;
  const rawInput = isRecord(toolCall) ? toolCall.rawInput : undefined;
  const reason = extractPermissionReason(toolCall, rawInput);
  const command = extractPermissionCommand(toolCall, rawInput);
  const cwd =
    isRecord(rawInput) && typeof rawInput.cwd === 'string' ? rawInput.cwd : '';
  const amendment = extractExecPolicyAmendment(rawInput);

  const lines = [plainText('Запрос разрешения')];
  if (reason) lines.push(`${plainText('Зачем:')} ${plainText(reason)}`);
  if (cwd) lines.push(`${plainText('CWD:')} ${inlineCode(cwd)}`);
  if (command) {
    lines.push(plainText('Команда:'));
    lines.push(codeBlock(limitText(command, 1800)));
  }
  if (amendment && amendment !== command) {
    lines.push(plainText('Policy amendment:'));
    lines.push(codeBlock(limitText(amendment, 700)));
  }
  if (!reason && !command && !cwd && !amendment) {
    lines.push(
      codeBlock(JSON.stringify(toolCall ?? {}, null, 2).slice(0, 1800)),
    );
  }
  return lines.join('\n');
}

export function formatPermissionOptionLabel(option: {
  optionId: string;
  name?: string;
  kind?: string;
}): string {
  const raw = option.name ?? option.optionId;
  const normalized = raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (option.kind === 'approve' || normalized === 'approved') return 'Approve';
  if (option.kind === 'reject' || option.kind === 'deny') return 'Deny';
  if (normalized === 'abort') return 'Abort';
  if (normalized === 'approved execpolicy amendment') return 'Approve policy';
  return titleCase(normalized || option.optionId);
}

export function findSafeDenialOption<
  T extends { optionId: string; kind?: string; name?: string },
>(options: T[]): T | undefined {
  return (
    options.find((option) => isSafeDenialValue(option.kind)) ??
    options.find((option) => isSafeDenialValue(option.optionId)) ??
    options.find((option) => isSafeDenialValue(option.name))
  );
}

function extractPermissionReason(
  toolCall: JsonValue | undefined,
  rawInput: JsonValue | undefined,
): string {
  if (isRecord(rawInput) && typeof rawInput.reason === 'string') {
    return normalizeWhitespace(rawInput.reason);
  }
  if (isRecord(toolCall) && Array.isArray(toolCall.content)) {
    for (const item of toolCall.content) {
      if (!isRecord(item) || !isRecord(item.content)) continue;
      const content = item.content;
      if (content.type !== 'text' || typeof content.text !== 'string') continue;
      const firstLine = content.text
        .split(/\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (firstLine) return normalizeWhitespace(firstLine);
    }
  }
  return '';
}

function extractPermissionCommand(
  toolCall: JsonValue | undefined,
  rawInput: JsonValue | undefined,
): string {
  if (isRecord(rawInput)) {
    const command = rawInput.command;
    if (Array.isArray(command)) {
      const parts = command.filter(
        (part): part is string => typeof part === 'string',
      );
      if (parts[1] === '-lc' && parts[2]) return parts[2];
      if (parts.length) return parts.join(' ');
    }
    const parsed = rawInput.parsed_cmd;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isRecord(item) && typeof item.cmd === 'string') return item.cmd;
      }
    }
  }
  if (isRecord(toolCall) && typeof toolCall.title === 'string') {
    return toolCall.title;
  }
  return '';
}

function extractExecPolicyAmendment(rawInput: JsonValue | undefined): string {
  if (!isRecord(rawInput)) return '';
  const amendment = rawInput.proposed_execpolicy_amendment;
  if (!Array.isArray(amendment)) return '';
  return amendment
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isSafeDenialValue(value: string | undefined): boolean {
  if (!value) return false;
  return /^(deny|denied|reject|rejected|cancel|cancelled|disallow|refuse|refused)$/i.test(
    value.trim(),
  );
}
