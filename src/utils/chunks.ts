export function splitTelegramText(text: string, limit = 3900): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = findCut(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

function findCut(value: string, limit: number): number {
  const newline = value.lastIndexOf('\n', limit);
  if (newline > limit * 0.5) return newline + 1;
  const space = value.lastIndexOf(' ', limit);
  if (space > limit * 0.5) return space + 1;
  return limit;
}
