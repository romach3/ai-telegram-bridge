import { describe, expect, it } from 'vitest';
import { splitTelegramText } from '../src/utils/chunks';

describe('splitTelegramText', () => {
  it('keeps short text as one chunk', () => {
    expect(splitTelegramText('short', 10)).toEqual(['short']);
  });

  it('prefers a newline near the limit', () => {
    expect(splitTelegramText('aaaa\nbbbb cccc', 10)).toEqual([
      'aaaa\nbbbb',
      'cccc',
    ]);
  });

  it('falls back to a space near the limit', () => {
    expect(splitTelegramText('aaaa bbbb cccc', 10)).toEqual([
      'aaaa bbbb',
      'cccc',
    ]);
  });

  it('hard-cuts when there is no useful boundary', () => {
    expect(splitTelegramText('abcdefghijkl', 5)).toEqual([
      'abcde',
      'fghij',
      'kl',
    ]);
  });
});
