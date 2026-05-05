import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findSafeDenialOption,
  isAuthorizedTelegramInput,
  isExpiredPermission,
  isPermissionCallbackContext,
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
});
