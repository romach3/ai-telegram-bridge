import type { BotCommand } from './types';

export const VISIBLE_TELEGRAM_COMMANDS: BotCommand[] = [
  { command: 'new', description: 'Create a new session' },
  { command: 'resume', description: 'Resume a recent session' },
  { command: 'status', description: 'Show current session' },
  { command: 'compact', description: 'Compact the active session' },
  { command: 'cancel', description: 'Cancel the current turn' },
  { command: 'help', description: 'Show help' },
];

export const HELP_LINES = [
  '/new',
  '/resume',
  '/status',
  '/compact',
  '/cancel',
  '/help',
  '',
  'Regular text is sent to the active ACP backend session.',
];

export const HIDDEN_TELEGRAM_COMMANDS = ['/load', '/sessions', '/backends'];
