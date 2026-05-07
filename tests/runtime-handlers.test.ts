import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpUpdateHandler } from '../src/runtime/handlers/acp-updates';
import { PermissionCallbackHandler } from '../src/runtime/handlers/permission-callbacks';
import { TelegramCallbackHandler } from '../src/runtime/handlers/telegram-callbacks';
import { TelegramMessageHandler } from '../src/runtime/handlers/telegram-messages';
import type { LiveTurnRenderer } from '../src/runtime/rendering/live-turn';
import { AgentRuntimeService } from '../src/runtime/services/agent-service';
import { PermissionWaitService } from '../src/runtime/services/permission-wait-service';
import type { PromptRunner } from '../src/runtime/services/prompt-runner';
import { SessionRuntimeService } from '../src/runtime/services/session-service';
import { TurnContextRegistry } from '../src/runtime/state/turn-context-registry';
import { savePermission, upsertSession } from '../src/state';
import type {
  AcpAgent,
  AcpRequestId,
  BridgeConfig,
  BridgeSessionDto,
  JsonValue,
  PendingPermissionDto,
} from '../src/types';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-handlers-'));
  process.env.AI_TELEGRAM_DATA_DIR = dataDir;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});

afterEach(async () => {
  delete process.env.AI_TELEGRAM_DATA_DIR;
  vi.useRealTimers();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('TelegramMessageHandler', () => {
  it('routes regular text to PromptRunner for the authorized private chat', async () => {
    const bot = fakeBot();
    const promptRunner = { handlePrompt: vi.fn() } as unknown as PromptRunner;
    const handler = messageHandler({ bot, promptRunner });

    await handler.handle({
      chatId: 42,
      userId: 42,
      chatType: 'private',
      text: 'do work',
    });

    expect(promptRunner.handlePrompt).toHaveBeenCalledWith(
      { chatId: 42, scopeId: 'chat:42' },
      'do work',
    );
  });

  it('shows an agent picker for /new when multiple agents are configured', async () => {
    const bot = fakeBot();
    const handler = messageHandler({
      bot,
      agents: agentService([fakeAgent('codex'), fakeAgent('gemini')]),
    });

    await handler.handle({
      chatId: 42,
      userId: 42,
      chatType: 'private',
      text: '/new',
    });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Choose agent'),
        replyMarkup: {
          inline_keyboard: [
            [{ text: 'Codex', callback_data: 'new:codex' }],
            [{ text: 'Gemini', callback_data: 'new:gemini' }],
          ],
        },
      }),
    );
  });
});

describe('TelegramCallbackHandler', () => {
  it('loads a selected resume session into the current topic scope', async () => {
    const bot = fakeBot();
    const agent = fakeAgent('codex');
    const agents = agentService([agent]);
    const sessions = new SessionRuntimeService(config(), agents, fakeLive());
    const resumeMenus = new Map([
      [
        'menu',
        {
          chatId: -100,
          messageThreadId: 2,
          scopeId: 'chat:-100:topic:2',
          sessions: [bridgeSession({ acpSessionId: 'old-session' })],
          createdAt: Date.now(),
        },
      ],
    ]);
    const handler = new TelegramCallbackHandler(
      bot,
      config({ allowedChats: [{ chatId: -100, topics: 'all' }] }),
      agents,
      sessions,
      new PermissionWaitService(agents, sessions),
      new TurnContextRegistry(),
      resumeMenus,
    );

    await handler.handle({
      id: 'cb',
      userId: 42,
      chatId: -100,
      chatType: 'supergroup',
      messageThreadId: 2,
      messageId: 50,
      data: 'resume:menu:0',
    });

    expect(agent.loadSession).toHaveBeenCalledWith({
      sessionId: 'old-session',
      cwd: '/repo',
    });
    expect(bot.deleteMessage).toHaveBeenCalledWith({
      chatId: -100,
      messageId: 50,
    });
    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100,
        messageThreadId: 2,
        text: expect.stringContaining('Resumed Codex session'),
      }),
    );
  });
});

describe('PermissionCallbackHandler', () => {
  it('responds to the ACP agent and deletes the permission message', async () => {
    const bot = fakeBot();
    const agent = fakeAgent('codex');
    await upsertSession(bridgeSession({ status: 'waiting_permission' }));
    await savePermission(
      permission({
        callbackKey: 'perm-key',
        messageId: 88,
        options: [{ optionId: 'approved' }],
      }),
    );

    const agents = agentService([agent]);
    const handler = new PermissionCallbackHandler(
      bot,
      config(),
      agents,
      new PermissionWaitService(
        agents,
        new SessionRuntimeService(config(), agents, fakeLive()),
      ),
    );

    await handler.handle(
      { id: 'cb', userId: 42, chatId: 42, messageId: 88 },
      'perm:perm-key:0',
    );

    expect(agent.respond).toHaveBeenCalledWith(1, {
      outcome: { outcome: 'selected', optionId: 'approved' },
    });
    expect(bot.deleteMessage).toHaveBeenCalledWith({
      chatId: 42,
      messageId: 88,
    });
  });

  it('expires stale permissions with a safe denial option', async () => {
    const bot = fakeBot();
    const agent = fakeAgent('codex');
    await upsertSession(bridgeSession({ status: 'waiting_permission' }));
    await savePermission(
      permission({
        callbackKey: 'old',
        messageId: 89,
        createdAt: '2025-12-31T23:00:00.000Z',
        options: [
          { optionId: 'approved', kind: 'approve' },
          { optionId: 'deny', name: 'Deny' },
        ],
      }),
    );
    const agents = agentService([agent]);

    await new PermissionCallbackHandler(
      bot,
      config(),
      agents,
      new PermissionWaitService(
        agents,
        new SessionRuntimeService(config(), agents, fakeLive()),
      ),
    ).handle({ id: 'cb', userId: 42, chatId: 42, messageId: 89 }, 'perm:old:0');

    expect(agent.respond).toHaveBeenCalledWith(1, {
      outcome: { outcome: 'selected', optionId: 'deny' },
    });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Permission expired; sent safe denial.',
      }),
    );
  });
});

describe('AcpUpdateHandler', () => {
  it('routes thought, tool status, and live output into live rendering', async () => {
    const live = fakeLive();
    const contexts = new TurnContextRegistry();
    const context = contexts.get({ chatId: 42, scopeId: 'chat:42' });
    context.activePrompt = true;
    context.activeAgentId = 'codex';
    context.collectingCurrentPrompt = true;
    contexts.bindAcpSession('codex', 's', 'chat:42');
    const handler = new AcpUpdateHandler(fakeBot(), live, contexts, vi.fn());

    await handler.handleMessage('codex', {
      method: 'session/update',
      params: {
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Checking files.' },
        },
      },
    });
    await handler.handleMessage('codex', {
      method: 'session/update',
      params: {
        sessionId: 's',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          status: 'pending',
          title: 'Read package.json',
        },
      },
    });
    await handler.handleMessage('codex', {
      method: 'session/update',
      params: {
        sessionId: 's',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'in_progress',
          rawOutput: 'last log line',
        },
      },
    });

    expect(live.updateTechnicalThought).toHaveBeenCalledWith(
      context,
      'Checking files.',
    );
    expect(live.updateTechnicalTool).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Read package.json'),
    );
    expect(live.updateTechnicalLog).toHaveBeenCalledWith(
      context,
      'last log line',
    );
  });

  it('creates a pending permission request with an inline keyboard', async () => {
    const bot = fakeBot();
    const contexts = new TurnContextRegistry();
    const context = contexts.get({ chatId: 42, scopeId: 'chat:42' });
    context.activePrompt = true;
    context.activeAgentId = 'codex';
    context.collectingCurrentPrompt = true;
    contexts.bindAcpSession('codex', 's', 'chat:42');
    await upsertSession(bridgeSession({ status: 'running' }));

    await new AcpUpdateHandler(
      bot,
      fakeLive(),
      contexts,
      vi.fn(),
    ).handleMessage('codex', {
      id: 7,
      method: 'session/request_permission',
      params: {
        sessionId: 's',
        toolCall: {
          rawInput: {
            command: ['/bin/sh', '-lc', 'echo ok'],
            cwd: '/repo',
          },
        },
        options: [{ optionId: 'approved' }, { optionId: 'abort' }],
      },
    });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 42,
        text: expect.stringContaining('echo ok'),
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: 'Approve',
                callback_data: expect.stringMatching(/^perm:/),
              },
            ],
            [{ text: 'Abort', callback_data: expect.stringMatching(/^perm:/) }],
          ],
        },
      }),
    );
  });
});

function messageHandler(
  input: {
    bot?: ReturnType<typeof fakeBot>;
    agents?: AgentRuntimeService;
    promptRunner?: PromptRunner;
  } = {},
): TelegramMessageHandler {
  const bot = input.bot ?? fakeBot();
  const agents = input.agents ?? agentService([fakeAgent('codex')]);
  const live = fakeLive();
  const sessions = new SessionRuntimeService(config(), agents, live);
  return new TelegramMessageHandler(
    bot,
    config(),
    live,
    agents,
    sessions,
    input.promptRunner ??
      ({
        handlePrompt: vi.fn(),
        run: vi.fn(),
      } as unknown as PromptRunner),
    new TurnContextRegistry(),
    new Map(),
  );
}

function config(input: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    botToken: 'token',
    allowedUserId: 42,
    allowedChats: [],
    defaultCwd: '/repo',
    defaultAgent: 'codex',
    agents: { codex: { command: 'codex' } },
    pollTimeoutSeconds: 30,
    flushIntervalMs: 100,
    liveEditIntervalMs: 100,
    ...input,
  };
}

function agentService(agents: AcpAgent[]): AgentRuntimeService {
  return new AgentRuntimeService(
    new Map(agents.map((agent) => [agent.id, agent])),
    'codex',
  );
}

function fakeAgent(id: string): AcpAgent {
  const emitter = new EventEmitter() as AcpAgent;
  emitter.id = id;
  emitter.label = id === 'codex' ? 'Codex' : 'Gemini';
  emitter.start = vi.fn();
  emitter.stop = vi.fn();
  emitter.initialize = vi.fn().mockResolvedValue(undefined);
  emitter.createSession = vi.fn().mockResolvedValue({ sessionId: `${id}-new` });
  emitter.loadSession = vi.fn().mockResolvedValue(undefined);
  emitter.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
  emitter.cancel = vi.fn();
  emitter.respond =
    vi.fn<(requestId: AcpRequestId, result: JsonValue) => void>();
  return emitter;
}

function fakeBot() {
  return {
    sendMessage: vi.fn().mockResolvedValue(100),
    editMessageText: vi.fn(),
    deleteMessage: vi.fn(),
    answerCallbackQuery: vi.fn(),
    sendChatAction: vi.fn(),
  };
}

function fakeLive(): LiveTurnRenderer {
  return {
    updateToolStatus: vi.fn(),
    updateTechnicalThought: vi.fn(),
    updateTechnicalTool: vi.fn(),
    updateTechnicalLog: vi.fn(),
    promotePendingAgentTextToTechnical: vi.fn(),
    resetTechnicalText: vi.fn(),
    finishToolStatus: vi.fn(),
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
    releaseToolStatus: vi.fn(),
    sendFinalAnswer: vi.fn(),
  } as unknown as LiveTurnRenderer;
}

function bridgeSession(
  input: Partial<BridgeSessionDto> = {},
): BridgeSessionDto {
  return {
    telegramUserId: 42,
    chatId: 42,
    scopeId: 'chat:42',
    agentId: 'codex',
    acpSessionId: 's',
    cwd: '/repo',
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}

function permission(
  input: Partial<PendingPermissionDto> = {},
): PendingPermissionDto {
  return {
    id: 1,
    callbackKey: undefined,
    chatId: 42,
    messageId: 88,
    sessionId: 's',
    agentId: 'codex',
    toolCall: null,
    options: [{ optionId: 'approved' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}
