import { describe, expect, it } from 'vitest';
import {
  codeBlock,
  inlineCode,
  plainText,
  renderTelegramMarkdown,
} from '../src/telegram/markdown';

describe('telegram markdown rendering', () => {
  it('escapes raw plain text for MarkdownV2', () => {
    expect(plainText('_*[]()~`>#+-=|{}.!\\')).toBe(
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\',
    );
  });

  it('wraps inline code and escapes code delimiters', () => {
    expect(inlineCode('a`b\\c')).toBe('`a\\`b\\\\c`');
  });

  it('wraps code blocks and escapes code delimiters', () => {
    expect(codeBlock('line ` one\\two')).toBe('```\nline \\` one\\\\two\n```');
  });

  it('converts user markdown into Telegram-compatible MarkdownV2', () => {
    expect(renderTelegramMarkdown('# Title\n\n- item_1\n- item*2')).toContain(
      '*Title*',
    );
    expect(renderTelegramMarkdown('hello_world').trim()).toBe('hello\\_world');
  });
});
