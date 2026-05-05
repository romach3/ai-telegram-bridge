import { AcpBackend, BridgeConfig } from '../types';
import { StdioAcpBackend } from './acp/stdio-backend';

export function createBackends(config: BridgeConfig): Map<string, AcpBackend> {
  const backends = new Map<string, AcpBackend>();
  for (const [id, backendConfig] of Object.entries(config.backends)) {
    if (backendConfig.type !== 'stdio-acp') {
      throw new Error(`Unsupported backend type for ${id}: ${backendConfig.type}`);
    }
    backends.set(id, new StdioAcpBackend(id, backendConfig, config.defaultCwd));
  }
  if (!backends.has(config.defaultBackend)) {
    throw new Error(`Default backend is not configured: ${config.defaultBackend}`);
  }
  return backends;
}
