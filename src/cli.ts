import { Command } from 'commander';
import { createAcpAgents } from './acp/stdio-agent';
import { getAcpConfig, getBridgeConfig } from './config';
import { serveBridge } from './runtime';

const program = new Command();

program
  .name('ai-telegram-bridge')
  .description('Telegram bridge for ACP agents')
  .version('0.1.0');

program
  .command('serve')
  .description('Start the Telegram bridge')
  .action(async () => {
    await serve();
  });

const probe = program.command('probe').description('Run diagnostics');

probe
  .command('acp')
  .description('Start a minimal ACP probe session')
  .action(async () => {
    await probeAcp();
  });

async function serve(): Promise<void> {
  const config = await getBridgeConfig();
  await serveBridge(config);
}

async function probeAcp(): Promise<void> {
  const config = await getAcpConfig();
  const agents = createAcpAgents({
    ...config,
  });
  const agent = agents.get(config.defaultAgent);
  if (!agent)
    throw new Error(`Default agent is not configured: ${config.defaultAgent}`);
  agent.on('message', (message) => console.log(JSON.stringify(message)));
  agent.on('stderr', (value) => {
    const text = String(value).trim();
    if (text) console.error(text);
  });
  await agent.initialize();
  const session = await agent.createSession({ cwd: config.defaultCwd });
  const result = await agent.prompt({
    sessionId: session.sessionId,
    text: 'Ответь ровно одним словом: PONG. Не запускай инструменты.',
  });
  console.log(JSON.stringify(result));
  agent.stop();
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
