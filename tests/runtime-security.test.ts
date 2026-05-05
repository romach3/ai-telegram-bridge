import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findSafeDenialOption,
  formatPermissionOptionLabel,
  formatPermissionRequestText,
  isAuthorizedTelegramInput,
  isExpiredPermission,
  isPermissionCallbackContext,
  normalizeSessions,
} from '../src/runtime';

describe('runtime security helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only the allowed private Telegram user and chat', () => {
    expect(
      isAuthorizedTelegramInput(
        { userId: 42, chatId: 42, chatType: 'private' },
        42,
      ),
    ).toBe(true);
    expect(
      isAuthorizedTelegramInput(
        { userId: 7, chatId: 7, chatType: 'private' },
        42,
      ),
    ).toBe(false);
    expect(
      isAuthorizedTelegramInput(
        { userId: 42, chatId: -100, chatType: 'supergroup' },
        42,
      ),
    ).toBe(false);
    expect(
      isAuthorizedTelegramInput(
        { userId: 42, chatId: 100, chatType: 'private' },
        42,
      ),
    ).toBe(false);
  });

  it('requires permission callbacks to match the original chat and message', () => {
    expect(
      isPermissionCallbackContext(
        { id: 'cb', userId: 42, chatId: 42, messageId: 10 },
        { chatId: 42, messageId: 10 },
      ),
    ).toBe(true);
    expect(
      isPermissionCallbackContext(
        { id: 'cb', userId: 42, chatId: 43, messageId: 10 },
        { chatId: 42, messageId: 10 },
      ),
    ).toBe(false);
    expect(
      isPermissionCallbackContext(
        { id: 'cb', userId: 42, chatId: 42, messageId: 11 },
        { chatId: 42, messageId: 10 },
      ),
    ).toBe(false);
  });

  it('expires stale or malformed permission requests', () => {
    expect(isExpiredPermission({ createdAt: '2025-12-31T23:46:00.000Z' })).toBe(
      false,
    );
    expect(isExpiredPermission({ createdAt: '2025-12-31T23:44:59.000Z' })).toBe(
      true,
    );
    expect(isExpiredPermission({ createdAt: 'not-a-date' })).toBe(true);
  });

  it('selects a safe denial permission option when one is available', () => {
    expect(
      findSafeDenialOption([
        { optionId: 'allow', kind: 'approve' },
        { optionId: 'deny', name: 'Deny' },
      ]),
    ).toMatchObject({ optionId: 'deny' });
    expect(
      findSafeDenialOption([
        { optionId: '1', kind: 'approve' },
        { optionId: '2', kind: 'reject' },
      ]),
    ).toMatchObject({ optionId: '2' });
    expect(
      findSafeDenialOption([
        { optionId: 'allow', kind: 'approve' },
        { optionId: 'continue', name: 'Continue' },
      ]),
    ).toBeUndefined();
  });

  it('renders permission requests as readable Telegram text', () => {
    const text = formatPermissionRequestText({
      toolCall: {
        title:
          'chmod +x tools/gemini-acp-task-runner/bin/gemini-acp-task && tools/gemini-acp-task-runner/bin/gemini-acp-task --help',
        rawInput: {
          command: [
            '/usr/bin/zsh',
            '-lc',
            'chmod +x tools/gemini-acp-task-runner/bin/gemini-acp-task && tools/gemini-acp-task-runner/bin/gemini-acp-task --help',
          ],
          cwd: '/home/romach/Code/raw',
          reason:
            'Разрешить восстановить executable bit и проверить wrapper --help?',
          proposed_execpolicy_amendment: [
            'chmod',
            '+x',
            'tools/gemini-acp-task-runner/bin/gemini-acp-task',
          ],
        },
      },
    });

    expect(text).toContain('Запрос разрешения');
    expect(text).toContain('Разрешить восстановить executable bit');
    expect(text).toContain('/home/romach/Code/raw');
    expect(text).toContain('chmod +x tools/gemini-acp-task-runner');
    expect(text).not.toContain('available_decisions');
    expect(text).not.toContain('rawInput');
  });

  it('renders permission decision labels compactly', () => {
    expect(
      formatPermissionOptionLabel({
        optionId: 'approved',
        name: 'Approved',
        kind: 'approve',
      }),
    ).toBe('Approve');
    expect(
      formatPermissionOptionLabel({
        optionId: 'approved_execpolicy_amendment',
        name: 'ApprovedExecpolicyAmendment',
      }),
    ).toBe('Approve policy');
    expect(formatPermissionOptionLabel({ optionId: 'abort' })).toBe('Abort');
  });

  it('normalizes sessions by migrating missing agent id and pruning unknown agents', () => {
    const result = normalizeSessions(
      [
        session({ acpSessionId: 'legacy', agentId: undefined }),
        session({ acpSessionId: 'known', agentId: 'codex' }),
        session({ acpSessionId: 'missing', agentId: 'removed' }),
      ],
      'codex',
      new Set(['codex']),
    );

    expect(result.changed).toBe(true);
    expect(result.sessions).toEqual([
      expect.objectContaining({ acpSessionId: 'legacy', agentId: 'codex' }),
      expect.objectContaining({ acpSessionId: 'known', agentId: 'codex' }),
    ]);
  });
});

function session(input: { acpSessionId: string; agentId?: string }) {
  return {
    telegramUserId: 1,
    chatId: 1,
    agentId: input.agentId,
    acpSessionId: input.acpSessionId,
    cwd: '/repo',
    status: 'idle' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
