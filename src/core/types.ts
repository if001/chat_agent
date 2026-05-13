export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AgentRequest {
  botId: string;
  systemPrompt: string;
  threadId?: string;
  messages: ChatMessage[];
}

export interface AgentResponse {
  content: string;
}

export interface AgentRuntime {
  respond(request: AgentRequest): Promise<AgentResponse>;
}

export interface SavedArticle {
  id: string;
  url: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  rawMarkdown: string;
  createdAt: Date;
}

export interface SearchResultItem {
  articleId: string;
  score: number;
  title: string;
  summary: string;
  tags: string[];
  url: string;
}

export interface SearchKnowledgeOptions {
  limit?: number;
  minScore?: number;
}

export interface KnowledgeRepository {
  saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle>;
  getSavedArticleById(articleId: string): Promise<SavedArticle | null>;
  getSavedArticleByUrl(url: string): Promise<SavedArticle | null>;
  searchSavedKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchResultItem[]>;
}

export interface UserNote {
  note: string;
  createdAt: Date;
}

export interface UserMemoryStore {
  rememberUserNote(botId: string, userId: string, note: string): Promise<void>;
  listUserNotes(botId: string, userId: string, limit: number): Promise<UserNote[]>;
  readMemoryFile(path: string): Promise<string>;
}

export interface DailyEvent {
  id: number;
  botId: string;
  userId: string;
  eventDate: string;
  summary: string;
  tags: string[];
  sourceMessage?: string;
  createdAt: Date;
}

export interface RememberDailyEventInput {
  botId: string;
  userId: string;
  eventDate: string;
  summary: string;
  tags?: string[];
  sourceMessage?: string;
}

export interface SearchDailyEventsInput {
  botId: string;
  userId: string;
  query: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export interface GetDailyEventsByDateInput {
  botId: string;
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

export interface WebListItem {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
}

export interface WebPage {
  url: string;
  title: string;
  markdown: string;
}

export interface WebClient {
  webList(query: string, k: number): Promise<WebListItem[]>;
  webPage(url: string): Promise<WebPage>;
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
