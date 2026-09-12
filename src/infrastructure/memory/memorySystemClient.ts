import type {
  MemorySystemService as PackageMemorySystemService,
  DailyEvent as PackageDailyEvent,
  RememberDailyEventInput as PackageRememberDailyEventInput,
  UserMemoryWriteResult as PackageUserMemoryWriteResult,
  UserNote as PackageUserNote,
  MemoryCatalog as PackageMemoryCatalog,
  MemoryCatalogRequest as PackageMemoryCatalogRequest,
  MemorySearchRequest as PackageMemorySearchRequest,
  MemorySearchResult as PackageMemorySearchResult,
} from "@chat-agent/memory-system";

type ChatRole = "system" | "user" | "assistant";

export type MemoryUserNote = PackageUserNote;
export type UserMemoryWriteResult = PackageUserMemoryWriteResult;
export type DailyEvent = PackageDailyEvent;
export type RememberDailyEventInput = PackageRememberDailyEventInput;
export type MemoryCatalog = PackageMemoryCatalog;
export type MemoryCatalogRequest = PackageMemoryCatalogRequest;
export type MemorySearchRequest = PackageMemorySearchRequest;
export type MemorySearchResult = PackageMemorySearchResult;
type MemorySystemService = Pick<
  PackageMemorySystemService,
  | "ingestTurnRecord"
  | "search"
  | "rememberUserNote"
  | "findUserNotesForManagement"
  | "replaceUserNote"
  | "deleteUserNote"
  | "rememberDailyEvent"
  | "inspectCatalog"
>;

interface TurnMessage {
  role: ChatRole;
  content: string;
  timestampIso: string;
}

export interface TurnRecordInput {
  botId: string;
  threadId: string;
  kind: "human" | "proactive" | "delegation";
  sourceInteractionId?: string;
  messages: TurnMessage[];
  createdAtIso: string;
}

export interface MemoryPolicyCard {
  policyCardId: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
}

export interface MemorySystemClient {
  ingestTurnRecord(input: TurnRecordInput): Promise<void>;
  rememberUserNote(userId: string, note: string): Promise<UserMemoryWriteResult>;
  findUserNotesForManagement(
    userId: string,
    query: string,
    limit: number,
  ): Promise<MemoryUserNote[]>;
  replaceUserNote(
    userId: string,
    noteId: number,
    note: string,
  ): Promise<UserMemoryWriteResult>;
  deleteUserNote(userId: string, noteId: number): Promise<boolean>;
  rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent>;
  inspectCatalog(input: MemoryCatalogRequest): Promise<MemoryCatalog>;
  searchMemory(input: MemorySearchRequest): Promise<MemorySearchResult>;
}

export interface MemorySystemClientOptions {
  postgresUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey?: string;
  ollamaEmbeddingBaseUrl?: string;
  ollamaEmbeddingModel?: string;
  ollamaEmbeddingDimension?: number;
}

export const formatPolicyCardsForPrompt = (
  cards: MemoryPolicyCard[],
): string => {
  const header =
    "以下は経験に基づくタスク達成の抽象的な手順です。\n" +
    "完全に従う必要はありませんが、参考にしてください。\n" +
    "appliesWhen: この方針を適用する会話・タスクの条件\n" +
    "recommendedBehavior: 推奨する応答方針\n" +
    "avoidBehavior: 避けるべき応答（記載がある場合）";
  const body = cards
    .map(
      (card) =>
        `- appliesWhen: ${card.appliesWhen}\n  recommendedBehavior: ${card.recommendedBehavior}${card.avoidBehavior ? `\n  avoidBehavior: ${card.avoidBehavior}` : ""}`,
    )
    .join("\n");
  return `${header}\n\n${body}`;
};

export const createMemorySystemClient = (
  options: MemorySystemClientOptions,
  loadService: (
    options: MemorySystemClientOptions,
  ) => MemorySystemService | null = loadMemorySystemService,
): MemorySystemClient => {
  const service = loadService(options);
  return {
    ingestTurnRecord: async (input) => {
      if (!service) {
        process.stdout.write(
          `[memory-ingest] skipped: service not available botId=${input.botId} threadId=${input.threadId}\n`,
        );
        return;
      }
      try {
        await service.ingestTurnRecord(input);
        process.stdout.write(
          `[memory-ingest] recorded botId=${input.botId} threadId=${input.threadId} messages=${input.messages.length}\n`,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stdout.write(
          `[memory-ingest] failed botId=${input.botId} threadId=${input.threadId}: ${message}\n`,
        );
      }
    },
    rememberUserNote: async (userId, note) => {
      if (!service) return { ok: false, error: "memory-system is unavailable" };
      return service.rememberUserNote({ userId, note });
    },
    findUserNotesForManagement: async (userId, query, limit) => {
      if (!service) return [];
      return service.findUserNotesForManagement({ userId, query, limit });
    },
    replaceUserNote: async (userId, noteId, note) => {
      if (!service) return { ok: false, error: "memory-system is unavailable" };
      return service.replaceUserNote({ userId, noteId, note });
    },
    deleteUserNote: async (userId, noteId) => {
      if (!service) return false;
      return service.deleteUserNote({ userId, noteId });
    },
    rememberDailyEvent: async (input) => {
      if (!service) throw new Error("memory-system is unavailable");
      return service.rememberDailyEvent(input);
    },
    inspectCatalog: async (input) => {
      if (!service) return unavailableCatalog("memory-system is unavailable");
      return service.inspectCatalog(input);
    },
    searchMemory: async (input) => {
      if (!service) return unavailableSearchResult(input);
      return service.search(input);
    },
  };
};

const unavailableCatalog = (reason: string): MemoryCatalog => {
  const entry = () => ({
    status: "unavailable" as const,
    available: false,
    topics: [],
    reason,
  });
  return {
    status: "unavailable",
    conversationHistory: entry(),
    userMemory: entry(),
    dailyEvents: entry(),
    policyCards: entry(),
  };
};

const unavailableSearchResult = (
  input: MemorySearchRequest,
): MemorySearchResult => {
  const unavailable = {
    status: "unavailable" as const,
    reason: "memory-system is unavailable",
  };
  return {
    ...(input.scopes.includes("conversation_history")
      ? { conversationHistory: unavailable }
      : {}),
    ...(input.scopes.includes("user_memory")
      ? { userMemory: unavailable }
      : {}),
    ...(input.scopes.includes("daily_events")
      ? { dailyEvents: unavailable }
      : {}),
    ...(input.scopes.includes("policy_cards")
      ? { policyCards: unavailable }
      : {}),
  };
};

const loadMemorySystemService = (
  options: MemorySystemClientOptions,
): MemorySystemService | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@chat-agent/memory-system") as {
      createMemorySystemService?: (params: {
        postgresUrl: string;
        ollamaBaseUrl: string;
        ollamaModel: string;
        ollamaAPIKey: string;
        ollamaEmbeddingBaseUrl?: string;
        ollamaEmbeddingModel?: string;
        ollamaEmbeddingDimension?: number;
      }) => MemorySystemService;
    };
    if (!mod.createMemorySystemService) {
      process.stdout.write(
        "[memory-system] createMemorySystemService not found; memory ingest is disabled\n",
      );
      return null;
    }
    return mod.createMemorySystemService({
      postgresUrl: options.postgresUrl,
      ollamaBaseUrl: options.ollamaBaseUrl,
      ollamaModel: options.ollamaModel,
      ollamaAPIKey: options.ollamaApiKey ?? "",
      ...(options.ollamaEmbeddingBaseUrl
        ? { ollamaEmbeddingBaseUrl: options.ollamaEmbeddingBaseUrl }
        : {}),
      ...(options.ollamaEmbeddingModel
        ? { ollamaEmbeddingModel: options.ollamaEmbeddingModel }
        : {}),
      ...(options.ollamaEmbeddingDimension
        ? { ollamaEmbeddingDimension: options.ollamaEmbeddingDimension }
        : {}),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stdout.write(
      `[memory-system] failed to load package; memory ingest is disabled: ${message}\n`,
    );
    return null;
  }
};
