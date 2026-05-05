import { describe, expect, it } from 'vitest';
import { labelFromPrompt, sessionDisplayLabel } from '../src/session-labels';
import type { BridgeSession } from '../src/types';

describe('session labels', () => {
  it('uses the first prompt as a normalized session label', () => {
    expect(labelFromPrompt('  build   the bridge\nsecurity pass  ')).toBe(
      'build the bridge security pass',
    );
  });

  it('truncates long labels without splitting unicode characters', () => {
    const label = labelFromPrompt(`${'а'.repeat(90)}🙂`);

    expect(Array.from(label)).toHaveLength(80);
    expect(label.endsWith('...')).toBe(true);
  });

  it('renders explicit labels before fallback metadata', () => {
    expect(
      sessionDisplayLabel(session({ label: 'bridge security' }), {
        id: 'codex',
        label: 'Codex',
      }),
    ).toBe('bridge security');
  });

  it('falls back to backend, workspace, and short session id', () => {
    expect(
      sessionDisplayLabel(
        session({
          acpSessionId: '1234567890abcdef',
          cwd: '/home/romach/Code/raw',
        }),
        { id: 'codex', label: 'Codex' },
      ),
    ).toBe('Codex · raw · 12345678...cdef');
  });
});

function session(input: Partial<BridgeSession>): BridgeSession {
  return {
    telegramUserId: 1,
    chatId: 1,
    backendId: 'codex',
    acpSessionId: 'session',
    cwd: '/repo',
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}
