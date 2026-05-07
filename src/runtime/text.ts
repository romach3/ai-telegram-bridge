import { isRecord } from '../acp/events';
import { inlineCode } from '../telegram/markdown';
import type { JsonValue } from '../types';

export function normalizePromptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function compactStatusText(value: string): string {
  const cleaned = sanitizeStatusText(value);
  const lines = cleaned
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.at(-1) ?? value.trim();
  if (text.length <= 900) return text;
  return `...${text.slice(-897)}`;
}

export function statusCodeBlock(value: string): string {
  return value
    .split('\n')
    .filter(Boolean)
    .map((line) => inlineCode(line))
    .join('\n');
}

export function renderTechnicalStatus(
  thought: string,
  tool: string,
  logLine: string,
): string {
  return [thought, tool, logLine].filter(Boolean).join('\n');
}

export function sanitizeStatusText(value: string): string {
  const lines = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^```[a-zA-Z0-9_-]*\s*$/, '')
        .replace(/^```\s*$/, '')
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !line.startsWith('Warning: Basic terminal detected'))
    .filter(
      (line) => !line.startsWith('Warning: 256-color support not detected'),
    )
    .filter(
      (line) => line !== 'Ripgrep is not available. Falling back to GrepTool.',
    );
  return (
    lines.join('\n').trim() ||
    value
      .replace(/```[a-zA-Z0-9_-]*/g, '')
      .replace(/```/g, '')
      .trim()
  );
}

export function stripTerminalNoise(value: string): string {
  return value
    .replace(/Warning: Basic terminal detected[^\n]*/g, '')
    .replace(/Warning: 256-color support not detected[^\n]*/g, '')
    .replace(/Ripgrep is not available\. Falling back to GrepTool\./g, '')
    .trim();
}

export function extractLatestStatusLine(value: string): string {
  const compact = repairSentenceBoundarySpacing(
    normalizePromptText(sanitizeStatusText(value)),
  );
  if (!compact) return '';
  const matches = compact.match(/[^.!?。！？]+[.!?。！？]+/g);
  const text = matches?.at(-1)?.trim() ?? compact;
  if (text.length <= 900) return text;
  return `...${text.slice(-897)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extractLiveOutput(
  update: JsonValue | undefined,
): string | null {
  if (!isRecord(update) || update.sessionUpdate !== 'tool_call_update')
    return null;
  const contentText = extractContentText(update.content);
  if (contentText) return stripTerminalNoise(contentText);
  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string' && rawOutput.trim())
    return stripTerminalNoise(rawOutput);
  if (!isRecord(rawOutput)) return null;
  const output =
    rawOutput.formatted_output ??
    rawOutput.aggregated_output ??
    rawOutput.stdout ??
    rawOutput.stderr;
  return typeof output === 'string' && output.trim()
    ? stripTerminalNoise(output)
    : null;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repairSentenceBoundarySpacing(value: string): string {
  return value.replace(/([.!?])([A-ZА-ЯЁ])/g, '$1 $2');
}

function extractContentText(content: JsonValue | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const chunks: string[] = [];
  for (const item of content) {
    if (!isRecord(item) || !isRecord(item.content)) continue;
    const inner = item.content;
    if (inner.type === 'text' && typeof inner.text === 'string')
      chunks.push(inner.text);
  }
  const text = chunks.join('\n').trim();
  return text || null;
}
