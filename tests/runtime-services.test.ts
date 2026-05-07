import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTurnRenderer } from '../src/runtime/rendering/live-turn';
import { AgentRuntimeService } from '../src/runtime/services/agent-service';
import { PermissionWaitService } from '../src/runtime/services/permission-wait-service';
import { PromptRunner } from '../src/runtime/services/prompt-runner';
import { SessionRuntimeService } from '../src/runtime/services/session-service';
import { TurnContextRegistry } from '../src/runtime/state/turn-context-registry';
import type { TurnContext } from '../src/runtime/types';
import { upsertSession } from '../src/state';
import type {
  AcpAgent,
  AcpAgentCreateSessionDto,
  AcpAgentLoadSessionDto,
  AcpAgentPromptDto,
  AcpAgentPromptResultDto,
  AcpRequestId,
  BridgeConfig,
  BridgeSessionDto,
  JsonValue,
} from '../src/types';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-runtime-'));
  process.env.AI_TELEGRAM_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.AI_TELEGRAM_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('AgentRuntimeService', () => {
  it('initializes and loads each ACP session once', async () => {
    const agent = fakeAgent();
    const service = new AgentRuntimeService(
      new Map([[agent.id, agent]]),
      'codex',
    );
    const session = bridgeSession({ acpSessionId: 's1' });

    await service.ensureSessionLoaded(session);
    await service.ensureSessionLoaded(session);

    expect(agent.start).toHaveBeenCalledTimes(1);
    expect(agent.initialize).toHaveBeenCalledTimes(1);
    expect(agent.loadSession).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error for unknown agents', () => {
    const service = new AgentRuntimeService(new Map(), 'codex');

    expect(() => service.get('missing')).toThrow('Unknown ACP agent: missing');
  });
});

describe('SessionRuntimeService', () => {
  it('creates a persisted session and labels it from the first prompt', async () => {
    const agent = fakeAgent();
    const agents = new AgentRuntimeService(
      new Map([[agent.id, agent]]),
      'codex',
    );
    const service = new SessionRuntimeService(config(), agents, fakeLive());

    const session = await service.createNew(scope(), agent);
    const labeled = service.withPromptLabel(
      session,
      'Сделай компактный отчет по статусу проекта',
    );

    expect(session).toMatchObject({
      telegramUserId: 42,
      chatId: 42,
      scopeId: 'chat:42',
      agentId: 'codex',
      acpSessionId: 'created-session',
      cwd: '/repo',
      status: 'idle',
    });
    expect(labeled.label).toBe('Сделай компактный отчет по статусу проекта');
  });

  it('resets active prompt state and live status timers through LiveTurnRenderer', () => {
    const live = fakeLive();
    const service = new SessionRuntimeService(
      config(),
      new AgentRuntimeService(
        new Map([[fakeAgent().id, fakeAgent()]]),
        'codex',
      ),
      live,
    );
    const context = turnContext({
      activePrompt: true,
      pendingPromptText: 'ping',
    });

    service.resetActivePromptState(context);

    expect(live.stopTyping).toHaveBeenCalledWith(context);
    expect(live.releaseToolStatus).toHaveBeenCalledWith(context);
    expect(context.activePrompt).toBe(false);
    expect(context.pendingPromptText).toBe('');
  });
});

describe('PromptRunner', () => {
  it('marks a successful prompt idle and sends the final answer', async () => {
    const agent = fakeAgent({
      prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    });
    const agents = new AgentRuntimeService(
      new Map([[agent.id, agent]]),
      'codex',
    );
    const live = fakeLive();
    const sessions = new SessionRuntimeService(config(), agents, live);
    const contexts = new TurnContextRegistry();
    const permissionWait = new PermissionWaitService(agents, sessions);
    const runner = new PromptRunner(
      fakeBot(),
      live,
      agents,
      sessions,
      permissionWait,
      contexts,
    );
    const context = turnContext({ activePrompt: true });
    const session = bridgeSession({ status: 'running' });
    await upsertSession(session);

    await runner.run(context, session, 'hello');

    expect(agent.prompt).toHaveBeenCalledWith({
      sessionId: 's',
      text: 'hello',
    });
    expect(live.sendFinalAnswer).toHaveBeenCalledWith(context);
    expect(live.releaseToolStatus).toHaveBeenCalledWith(context);
  });

  it('marks a failed prompt failed and reports an ACP error', async () => {
    const bot = fakeBot();
    const agent = fakeAgent({
      prompt: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const agents = new AgentRuntimeService(
      new Map([[agent.id, agent]]),
      'codex',
    );
    const live = fakeLive();
    const sessions = new SessionRuntimeService(config(), agents, live);
    const runner = new PromptRunner(
      bot,
      live,
      agents,
      sessions,
      new PermissionWaitService(agents, sessions),
      new TurnContextRegistry(),
    );

    await runner.run(
      turnContext(),
      bridgeSession({ status: 'running' }),
      'fail',
    );

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 42,
        text: expect.stringContaining('ACP error: boom'),
      }),
    );
  });
});

describe('PermissionWaitService', () => {
  it('cancels stale waiting_permission sessions without pending permissions', async () => {
    const agent = fakeAgent();
    const agents = new AgentRuntimeService(
      new Map([[agent.id, agent]]),
      'codex',
    );
    const sessions = new SessionRuntimeService(config(), agents, fakeLive());
    const service = new PermissionWaitService(agents, sessions);
    await upsertSession(bridgeSession({ status: 'waiting_permission' }));

    await service.recoverStaleWait(scope(), turnContext());

    expect(agent.cancel).toHaveBeenCalledWith({ sessionId: 's' });
  });
});

function config(): BridgeConfig {
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
  };
}

function scope() {
  return { chatId: 42, scopeId: 'chat:42' };
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

function turnContext(input: Partial<TurnContext> = {}): TurnContext {
  return {
    ...scope(),
    activePrompt: false,
    buffer: '',
    pendingPromptText: '',
    pendingUserText: '',
    collectingCurrentPrompt: false,
    preToolAgentBuffer: '',
    currentAgentStatusSegment: '',
    sawToolEvent: false,
    activeToolCallIds: new Set(),
    toolStatusText: '',
    technicalThoughtText: '',
    technicalToolText: '',
    technicalLogText: '',
    toolStatusLastText: '',
    ...input,
  };
}

function fakeAgent(overrides: Partial<AcpAgent> = {}): AcpAgent {
  const emitter = new EventEmitter() as AcpAgent;
  emitter.id = 'codex';
  emitter.label = 'Codex';
  emitter.start = vi.fn();
  emitter.stop = vi.fn();
  emitter.initialize = vi.fn().mockResolvedValue(undefined);
  emitter.createSession = vi
    .fn<(input: AcpAgentCreateSessionDto) => Promise<{ sessionId: string }>>()
    .mockResolvedValue({ sessionId: 'created-session' });
  emitter.loadSession = vi
    .fn<(input: AcpAgentLoadSessionDto) => Promise<void>>()
    .mockResolvedValue(undefined);
  emitter.prompt = vi
    .fn<(input: AcpAgentPromptDto) => Promise<AcpAgentPromptResultDto>>()
    .mockResolvedValue({ stopReason: 'end_turn' });
  emitter.cancel = vi.fn();
  emitter.respond =
    vi.fn<(requestId: AcpRequestId, result: JsonValue) => void>();
  return Object.assign(emitter, overrides);
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

function fakeBot() {
  return {
    sendMessage: vi.fn().mockResolvedValue(1),
    editMessageText: vi.fn(),
    deleteMessage: vi.fn(),
    answerCallbackQuery: vi.fn(),
    sendChatAction: vi.fn(),
  };
}
