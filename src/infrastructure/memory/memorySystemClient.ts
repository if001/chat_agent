type ChatRole = "system" | "user" | "assistant";

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

interface MemorySystemService {
  ingestTurnRecord(input: TurnRecordInput): Promise<void>;
  queryApplicablePolicyCards(input: {
    botId: string;
    threadId: string;
    currentContext: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      appliesWhen: string;
      recommendedBehavior: string;
      avoidBehavior?: string;
      episodeIds: string[];
    }>
  >;
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
): MemorySystemClient => {
  const service = loadMemorySystemService(options);
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
    console.log("options.ollamaApiKey", options.ollamaApiKey);
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
