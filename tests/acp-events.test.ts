import { describe, expect, it } from 'vitest';
import {
  describeUpdate,
  extractPermissionOptions,
  extractSessionId,
  extractUpdate,
  getAgentTextChunk,
  getAgentThoughtChunk,
  getUserTextChunk,
} from '../src/backend/acp/events';

describe('ACP event parsing', () => {
  it('extracts text chunks by update type', () => {
    expect(
      getAgentTextChunk({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'answer' },
      }),
    ).toBe('answer');
    expect(
      getAgentThoughtChunk({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking' },
      }),
    ).toBe('thinking');
    expect(
      getUserTextChunk({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'prompt' },
      }),
    ).toBe('prompt');
  });

  it('ignores malformed chunks', () => {
    expect(getAgentTextChunk(null)).toBeNull();
    expect(
      getAgentTextChunk({ sessionUpdate: 'agent_message_chunk' }),
    ).toBeNull();
    expect(
      getAgentTextChunk({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', text: 'nope' },
      }),
    ).toBeNull();
  });

  it('describes tool calls and tool outputs', () => {
    expect(
      describeUpdate({
        sessionUpdate: 'tool_call',
        title: 'Read file',
        status: 'in_progress',
      }),
    ).toBe('Tool: Read file (in_progress)');

    expect(
      describeUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'completed',
      }),
    ).toBe('Tool update: call_1 -> completed');

    expect(
      describeUpdate({
        sessionUpdate: 'tool_call_update',
        rawOutput: { stdout: 'done' },
      }),
    ).toBe('done');
  });

  it('extracts permission options and session ids', () => {
    expect(
      extractPermissionOptions({
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'approve' },
          { id: 'deny' },
          { nope: true },
        ],
      }),
    ).toEqual([
      { optionId: 'allow', name: 'Allow', kind: 'approve' },
      { optionId: 'deny', name: 'deny', kind: undefined },
    ]);

    expect(extractSessionId({ sessionId: 's1' })).toBe('s1');
    expect(extractSessionId({})).toBeNull();
  });

  it('extracts update payload from params', () => {
    const update = { sessionUpdate: 'usage_update' };
    expect(extractUpdate({ update })).toBe(update);
    expect(extractUpdate(null)).toBeNull();
  });
});
