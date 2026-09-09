export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  additional_kwargs?: Record<string, unknown>;
}

export interface AgentRequest {
  botId: string;
  userId: string;
  systemPrompt: string;
  requestContext?: string;
  threadId?: string;
  messages: ChatMessage[];
}

export interface AgentResponse {
  content: string;
}

export interface AgentRuntime {
  respond(request: AgentRequest): Promise<AgentResponse>;
}

export type {
  KnowledgeRepository,
  KnowledgeCatalogSourceItem,
  SavedArticle,
  SearchKnowledgeOptions,
  SearchResultItem,
  WebClient,
  WebListItem,
  WebPage,
} from "@chat-agent/knowledge-access";

export interface ChannelMessage {
  channelId: string;
  authorId: string;
  content: string;
  mentionsBot: boolean;
}

export interface BotIdentity {
  botId: string;
  systemPrompt: string;
}
