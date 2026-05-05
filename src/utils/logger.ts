export function log(message: string): void {
  console.log(`[bridge] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[bridge] ${message}`);
}

export function error(message: string): void {
  console.error(`[bridge] ${message}`);
}
