import type {
  MemorySystemService as PackageMemorySystemService,
  DailyEvent as PackageDailyEvent,
  GetDailyEventsByDateInput as PackageGetDailyEventsByDateInput,
  RememberDailyEventInput as PackageRememberDailyEventInput,
  SearchDailyEventsInput as PackageSearchDailyEventsInput,
  UserMemoryWriteResult as PackageUserMemoryWriteResult,
  UserNote as PackageUserNote,
} from "@chat-agent/memory-system";

type ChatRole = "system" | "user" | "assistant";

export type MemoryUserNote = PackageUserNote;
export type UserMemoryWriteResult = PackageUserMemoryWriteResult;
export type DailyEvent = PackageDailyEvent;
export type RememberDailyEventInput = PackageRememberDailyEventInput;
export type SearchDailyEventsInput = PackageSearchDailyEventsInput;
export type GetDailyEventsByDateInput = PackageGetDailyEventsByDateInput;
type MemorySystemService = Pick<
  PackageMemorySystemService,
  | "ingestTurnRecord"
  | "queryApplicablePolicyCards"
  | "rememberUserNote"
  | "searchUserNotes"
  | "replaceUserNote"
  | "deleteUserNote"
  | "rememberDailyEvent"
  | "searchDailyEvents"
  | "getDailyEventsByDate"
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
  id: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
  episodeIds: string[];
}

export interface MemorySystemClient {
  ingestTurnRecord(input: TurnRecordInput): Promise<void>;
  queryApplicablePolicyCards(input: {
    botId: string;
    threadId: string;
    currentContext: string;
    limit?: number;
  }): Promise<MemoryPolicyCard[]>;
  rememberUserNote(userId: string, note: string): Promise<UserMemoryWriteResult>;
  searchUserNotes(
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
  searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]>;
  getDailyEventsByDate(input: GetDailyEventsByDateInput): Promise<DailyEvent[]>;
}

export interface MemorySystemClientOptions {
  postgresUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey?: string;
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
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        process.stdout.write(
          `[memory-ingest] failed botId=${input.botId} threadId=${input.threadId}: ${message}\n`,
        );
      }
    },
    queryApplicablePolicyCards: async (input) => {
      if (!service) {
        return [];
      }
      return service.queryApplicablePolicyCards(input);
    },
    rememberUserNote: async (userId, note) => {
      if (!service) return { ok: false, error: "memory-system is unavailable" };
      return service.rememberUserNote({ userId, note });
    },
    searchUserNotes: async (userId, query, limit) => {
      if (!service) return [];
      return service.searchUserNotes({ userId, query, limit });
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
    searchDailyEvents: async (input) => {
      if (!service) return [];
      return service.searchDailyEvents(input);
    },
    getDailyEventsByDate: async (input) => {
      if (!service) return [];
      return service.getDailyEventsByDate(input);
    },
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
