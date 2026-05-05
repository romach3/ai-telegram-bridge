import { describe, expect, it } from 'vitest';
import {
  HELP_LINES,
  HIDDEN_TELEGRAM_COMMANDS,
  VISIBLE_TELEGRAM_COMMANDS,
} from '../src/telegram/commands';

describe('Telegram command surface', () => {
  it('keeps debug commands hidden from menu and help', () => {
    const visibleCommands = VISIBLE_TELEGRAM_COMMANDS.map(
      (item) => `/${item.command}`,
    );

    for (const command of HIDDEN_TELEGRAM_COMMANDS) {
      expect(visibleCommands).not.toContain(command);
      expect(HELP_LINES).not.toContain(command);
    }
  });
});
