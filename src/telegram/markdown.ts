import telegramifyMarkdown from 'telegramify-markdown';

export function renderTelegramMarkdown(markdown: string): string {
  return telegramifyMarkdown(markdown, 'escape');
}

export function plainText(value: string): string {
  return value.replace(/([\\_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export function inlineCode(value: string): string {
  return `\`${escapeCode(value)}\``;
}

export function codeBlock(value: string): string {
  return `\`\`\`\n${escapeCode(value)}\n\`\`\``;
}

function escapeCode(value: string): string {
  return value.replace(/([\\`])/g, '\\$1');
}
