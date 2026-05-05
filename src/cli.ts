import { Command } from 'commander';
import { createBackends } from './backend/registry';
import { getAcpConfig, getBridgeConfig } from './config';
import { serveBridge } from './runtime';

const program = new Command();

program.name('ai-telegram-bridge').description('Telegram bridge for ACP backends').version('0.1.0');

program.command('serve').description('Start the Telegram bridge').action(async () => {
  await serve();
});

const probe = program.command('probe').description('Run diagnostics');

probe.command('acp').description('Start a minimal ACP probe session').action(async () => {
  await probeAcp();
});

async function serve(): Promise<void> {
  const config = await getBridgeConfig();
  await serveBridge(config);
}

async function probeAcp(): Promise<void> {
  const config = await getAcpConfig();
  const backends = createBackends({
    botToken: 'probe',
    allowedUserId: 1,
    pollTimeoutSeconds: 1,
    flushIntervalMs: 1,
    liveEditIntervalMs: 1,
    defaultAcpCommand: '',
    ...config,
  });
  const backend = backends.get(config.defaultBackend);
  if (!backend) throw new Error(`Default backend is not configured: ${config.defaultBackend}`);
  backend.on('message', (message) => console.log(JSON.stringify(message)));
  backend.on('stderr', (value) => {
    const text = String(value).trim();
    if (text) console.error(text);
  });
  await backend.initialize();
  const session = await backend.createSession({ cwd: config.defaultCwd });
  const result = await backend.prompt({ sessionId: session.sessionId, text: 'Ответь ровно одним словом: PONG. Не запускай инструменты.' });
  console.log(JSON.stringify(result));
  backend.stop();
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
