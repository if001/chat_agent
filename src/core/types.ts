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
