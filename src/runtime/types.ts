import type { BridgeSessionDto } from '../types';

export type ConversationScope = {
  scopeId: string;
  chatId: number;
  messageThreadId?: number;
};

export type TurnContext = ConversationScope & {
  activePrompt: boolean;
  activeAgentId?: string;
  activeAcpSessionId?: string;
  buffer: string;
  pendingPromptText: string;
  pendingUserText: string;
  collectingCurrentPrompt: boolean;
  preToolAgentBuffer: string;
  currentAgentStatusSegment: string;
  sawToolEvent: boolean;
  activeToolCallIds: Set<string>;
  typingTimer?: NodeJS.Timeout;
  toolStatusMessageId?: number;
  toolStatusText: string;
  technicalThoughtText: string;
  technicalToolText: string;
  technicalLogText: string;
  toolStatusTimer?: NodeJS.Timeout;
  toolStatusLastText: string;
};

export type ResumeMenu = ConversationScope & {
  sessions: BridgeSessionDto[];
  createdAt: number;
};
