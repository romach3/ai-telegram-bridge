import { JsonObject, JsonValue, PermissionOption, isJsonObject } from '../../types';

export function getAgentTextChunk(update: JsonValue | undefined): string | null {
  if (!isRecord(update)) return null;
  if (update.sessionUpdate !== 'agent_message_chunk') return null;
  const content = update.content;
  if (!isRecord(content) || content.type !== 'text') return null;
  return typeof content.text === 'string' ? content.text : null;
}

export function getAgentThoughtChunk(update: JsonValue | undefined): string | null {
  if (!isRecord(update)) return null;
  if (update.sessionUpdate !== 'agent_thought_chunk') return null;
  const content = update.content;
  if (!isRecord(content) || content.type !== 'text') return null;
  return typeof content.text === 'string' ? content.text : null;
}

export function getUserTextChunk(update: JsonValue | undefined): string | null {
  if (!isRecord(update)) return null;
  if (update.sessionUpdate !== 'user_message_chunk') return null;
  const content = update.content;
  if (!isRecord(content) || content.type !== 'text') return null;
  return typeof content.text === 'string' ? content.text : null;
}

export function describeUpdate(update: JsonValue | undefined): string | null {
  if (!isRecord(update)) return null;
  switch (update.sessionUpdate) {
    case 'tool_call':
      return `Tool: ${String(update.title ?? update.toolCallId ?? 'tool call')} (${String(update.status ?? 'pending')})`;
    case 'tool_call_update':
      return describeToolCallUpdate(update);
    case 'plan':
      return 'Plan updated';
    case 'usage_update':
      return null;
    case 'available_commands_update':
      return null;
    default:
      return null;
  }
}

function describeToolCallUpdate(update: JsonObject): string {
  const output = extractToolOutput(update);
  if (output) return output;
  return `Tool update: ${String(update.toolCallId ?? 'tool')} -> ${String(update.status ?? 'unknown')}`;
}

function extractToolOutput(update: JsonObject): string | null {
  const contentText = extractContentText(update.content);
  if (contentText) return contentText;
  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string') return rawOutput;
  if (isRecord(rawOutput)) {
    const formatted = rawOutput.formatted_output ?? rawOutput.aggregated_output ?? rawOutput.stdout ?? rawOutput.stderr;
    if (typeof formatted === 'string' && formatted.trim()) return formatted;
  }
  return null;
}

function extractContentText(content: JsonValue | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const chunks: string[] = [];
  for (const item of content) {
    if (!isRecord(item) || !isRecord(item.content)) continue;
    const inner = item.content;
    if (inner.type === 'text' && typeof inner.text === 'string') chunks.push(inner.text);
  }
  const text = chunks.join('\n').trim();
  return text || null;
}

export function extractPermissionOptions(params: JsonValue | undefined): PermissionOption[] {
  if (!isRecord(params) || !Array.isArray(params.options)) return [];
  const result: PermissionOption[] = [];
  for (const option of params.options) {
    if (!isRecord(option)) continue;
    const rawId = option.optionId ?? option.id;
    if (typeof rawId !== 'string') continue;
    result.push({
      optionId: rawId,
      name: typeof option.name === 'string' ? option.name : rawId,
      kind: typeof option.kind === 'string' ? option.kind : undefined,
    });
  }
  return result;
}

export function extractSessionId(params: JsonValue | undefined): string | null {
  return isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : null;
}

export function extractUpdate(params: JsonValue | undefined): JsonValue | undefined {
  return isRecord(params) ? params.update : null;
}

export function isRecord(value: unknown): value is JsonObject {
  return isJsonObject(value);
}
