import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(path.dirname(currentFile));
const toolDir = path.dirname(srcDir);

export const TOOL_DIR = toolDir;
export const ROOT_DIR = path.resolve(toolDir, '..', '..');
