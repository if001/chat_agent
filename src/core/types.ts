export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
  SavedArticle,
  SearchKnowledgeOptions,
  SearchResultItem,
  WebClient,
  WebListItem,
  WebPage,
} from "@chat-agent/knowledge-access";

export interface UserNote {
  id: number;
  note: string;
  createdAt: Date;
}

export interface UserMemoryStore {
  rememberUserNote(userId: string, note: string): Promise<UserNote>;
  searchUserNotes(userId: string, query: string, limit: number): Promise<UserNote[]>;
  replaceUserNote(
    userId: string,
    noteId: number,
    note: string,
  ): Promise<UserNote | null>;
  deleteUserNote(userId: string, noteId: number): Promise<boolean>;
}

export interface DailyEvent {
  id: number;
  userId: string;
  eventDate: string;
  summary: string;
  tags: string[];
  sourceMessage?: string;
  createdAt: Date;
}

export interface RememberDailyEventInput {
  userId: string;
  eventDate: string;
  summary: string;
  tags?: string[];
  sourceMessage?: string;
}

export interface SearchDailyEventsInput {
  userId: string;
  query: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export interface GetDailyEventsByDateInput {
  userId: string;
  date: string;
  windowDays?: number;
  limit?: number;
}

export interface DailyEventRepository {
  rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent>;
  searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]>;
  getDailyEventsByDate(input: GetDailyEventsByDateInput): Promise<DailyEvent[]>;
}

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
