import { appendAcpEventLog, defaultAcpEventLogPath } from '../acp/event-log';
import { createAcpAgents } from '../acp/stdio-agent';
import { clearPermissions, markInterruptedSessionsFailed } from '../state';
import { TelegramBotApi } from '../telegram/bot-api';
import { VISIBLE_TELEGRAM_COMMANDS } from '../telegram/commands';
import { plainText } from '../telegram/markdown';
import type {
  BridgeConfig,
  JsonObject,
  TelegramCallbackDto,
  TelegramTextMessageDto,
} from '../types';
import { log, warn } from '../utils/logger';
import { AcpUpdateHandler } from './handlers/acp-updates';
import { TelegramCallbackHandler } from './handlers/telegram-callbacks';
import { TelegramMessageHandler } from './handlers/telegram-messages';
import { scopeFromTelegramInput } from './policy/authorization';
import { LiveTurnRenderer } from './rendering/live-turn';
import { errorMessage } from './rendering/text';
import { AgentRuntimeService } from './services/agent-service';
import { PermissionWaitService } from './services/permission-wait-service';
import { PromptRunner } from './services/prompt-runner';
import { SessionRuntimeService } from './services/session-service';
import { TurnContextRegistry } from './state/turn-context-registry';
import type { ConversationScope, ResumeMenu } from './types';

export class BridgeRuntime {
  private readonly bot: TelegramBotApi;
  private readonly live: LiveTurnRenderer;
  private readonly agentService: AgentRuntimeService;
  private readonly sessionService: SessionRuntimeService;
  private readonly permissionWaitService: PermissionWaitService;
  private readonly promptRunner: PromptRunner;
  private readonly acpUpdates: AcpUpdateHandler;
  private readonly callbackHandler: TelegramCallbackHandler;
  private readonly messageHandler: TelegramMessageHandler;
  private readonly contexts = new TurnContextRegistry();
  private readonly resumeMenus = new Map<string, ResumeMenu>();

  constructor(private readonly config: BridgeConfig) {
    this.bot = new TelegramBotApi(config.botToken);
    this.live = new LiveTurnRenderer(this.bot);
    const agents = createAcpAgents(config);
    this.agentService = new AgentRuntimeService(agents, config.defaultAgent);
    this.sessionService = new SessionRuntimeService(
      config,
      this.agentService,
      this.live,
    );
    this.permissionWaitService = new PermissionWaitService(
      this.agentService,
      this.sessionService,
    );
    this.promptRunner = new PromptRunner(
      this.bot,
      this.live,
      this.agentService,
      this.sessionService,
      this.permissionWaitService,
      this.contexts,
    );
    this.acpUpdates = new AcpUpdateHandler(
      this.bot,
      this.live,
      this.contexts,
      (message) => this.logAcpEvent(message),
    );
    this.callbackHandler = new TelegramCallbackHandler(
      this.bot,
      config,
      this.agentService,
      this.sessionService,
      this.permissionWaitService,
      this.contexts,
      this.resumeMenus,
    );
    this.messageHandler = new TelegramMessageHandler(
      this.bot,
      config,
      this.live,
      this.agentService,
      this.sessionService,
      this.promptRunner,
      this.contexts,
      this.resumeMenus,
    );
    for (const agent of this.agentService.all()) {
      agent.on(
        'message',
        (message) => void this.acpUpdates.handleMessage(agent.id, message),
      );
      agent.on('stderr', (value) => {
        const text = String(value).trim();
        if (text) warn(`[${agent.id}] ${text}`);
      });
    }
  }

  async start(): Promise<void> {
    const agent = this.agentService.default();
    await this.resetInterruptedState();
    await this.agentService.ensureInitialized(agent);
    await this.registerTelegramCommands();
    await this.warnIfWebhookConfigured();
    this.bot.onText((message) => this.handleTextEvent(message));
    this.bot.onCallback((callback) => this.handleCallbackEvent(callback));
    this.bot.onError((error) =>
      warn(
        `Telegram bot failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    log(`ACP agent initialized: ${agent.id}`);
    await this.bot.start(this.config.pollTimeoutSeconds);
  }

  private async handleTextEvent(
    message: TelegramTextMessageDto,
  ): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      await this.reportBridgeError(scopeFromTelegramInput(message), error);
    }
  }

  private async handleCallbackEvent(
    callback: TelegramCallbackDto,
  ): Promise<void> {
    try {
      await this.handleCallback(callback);
    } catch (error) {
      if (callback.chatId)
        await this.reportBridgeError(
          scopeFromTelegramInput({
            chatId: callback.chatId,
            messageThreadId: callback.messageThreadId,
          }),
          error,
        );
      else warn(error instanceof Error ? error.message : String(error));
    }
  }

  private async reportBridgeError(
    scope: ConversationScope,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.bot.sendMessage({
      chatId: scope.chatId,
      messageThreadId: scope.messageThreadId,
      text: plainText(`Bridge error: ${message}`),
    });
    warn(message);
  }

  private async handleMessage(message: TelegramTextMessageDto): Promise<void> {
    await this.messageHandler.handle(message);
  }

  private async registerTelegramCommands(): Promise<void> {
    try {
      await this.bot.setMyCommands(VISIBLE_TELEGRAM_COMMANDS);
    } catch (error) {
      warn(`Telegram command registration failed: ${errorMessage(error)}`);
    }
  }

  private async handleCallback(callback: TelegramCallbackDto): Promise<void> {
    await this.callbackHandler.handle(callback);
  }

  private async logAcpEvent(message: JsonObject): Promise<void> {
    const filePath =
      this.config.acpEventLogPath === 'default'
        ? defaultAcpEventLogPath()
        : this.config.acpEventLogPath;
    if (!filePath) return;
    try {
      await appendAcpEventLog(filePath, message);
    } catch (error) {
      warn(
        `ACP event log failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async resetInterruptedState(): Promise<void> {
    await clearPermissions();
    await markInterruptedSessionsFailed();
  }

  private async warnIfWebhookConfigured(): Promise<void> {
    try {
      const info = await this.bot.getWebhookInfo();
      if (!info.url) return;
      warn(
        [
          'Telegram webhook is configured for this bot token.',
          'Polling bridge instances compete with webhooks or other consumers.',
          'Use one bot token for one bridge instance, or rotate/create a token.',
        ].join(' '),
      );
    } catch (error) {
      warn(`Telegram webhook diagnostic failed: ${errorMessage(error)}`);
    }
  }
}

export async function serveBridge(config: BridgeConfig): Promise<void> {
  const runtime = new BridgeRuntime(config);
  await runtime.start();
}
