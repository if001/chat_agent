import { join } from "node:path";
type ChatRole = "system" | "user" | "assistant";

interface TurnMessage {
  role: ChatRole;
  content: string;
  timestampIso: string;
}

export interface SimplePomdpTurnRecordInput {
  botId: string;
  threadId: string;
  messages: TurnMessage[];
  createdAtIso: string;
}

interface SimplePomdpSystemService {
  ingestTurnRecord(input: SimplePomdpTurnRecordInput): Promise<void>;
}

export interface SimplePomdpSystemClient {
  ingestTurnRecord(input: SimplePomdpTurnRecordInput): Promise<void>;
}

export interface SimplePomdpSystemClientOptions {
  storeDir: string;
  maxTurnsPerThread?: number;
}

export const createSimplePomdpSystemClient = (
  options: SimplePomdpSystemClientOptions,
): SimplePomdpSystemClient => {
  const service = loadSimplePomdpSystemService(options);
  return {
    ingestTurnRecord: async (input) => {
      if (!service) {
        return;
      }
      await service.ingestTurnRecord(input);
    },
  };
};

const loadSimplePomdpSystemService = (
  options: SimplePomdpSystemClientOptions,
): SimplePomdpSystemService | null => {
  try {
    const mod = loadPackageModule();
    if (!mod.createSimplePomdpSystemService || !mod.createFileTurnRecordStore) {
      process.stdout.write(
        "[simple-pomdp] required exports not found; ingest is disabled\n",
      );
      return null;
    }
    return mod.createSimplePomdpSystemService({
      turnRecordStore: mod.createFileTurnRecordStore({
        baseDir: join(options.storeDir, "turn-records"),
        ...(options.maxTurnsPerThread !== undefined
          ? { maxTurnsPerThread: options.maxTurnsPerThread }
          : {}),
      }),
      userBeliefStore: {
        getUserBelief: async () => null,
        saveUserBelief: async () => {},
      },
      interactionLogStore: {
        listRecentInteractionLogs: async () => [],
        saveInteractionLog: async () => {},
      },
      plannerModel: {
        generateJson: async () => {
          throw new Error(
            "plannerModel is not available in ingest-only client runtime",
          );
        },
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stdout.write(
      `[simple-pomdp] failed to load package; ingest is disabled: ${message}\n`,
    );
    return null;
  }
};

const loadPackageModule = (): {
  createSimplePomdpSystemService?: (params: {
    turnRecordStore: {
      appendTurnRecord(turn: SimplePomdpTurnRecordInput): Promise<void>;
      listRecentTurnRecords(input: {
        botId: string;
        threadId: string;
        limit: number;
      }): Promise<SimplePomdpTurnRecordInput[]>;
    };
    userBeliefStore: {
      getUserBelief(userId: string): Promise<null>;
      saveUserBelief(): Promise<void>;
    };
    interactionLogStore: {
      listRecentInteractionLogs(input: {
        userId: string;
        limit: number;
      }): Promise<[]>;
      saveInteractionLog(): Promise<void>;
    };
    plannerModel: {
      generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
    };
  }) => SimplePomdpSystemService;
  createFileTurnRecordStore?: (params: {
    baseDir: string;
    maxTurnsPerThread?: number;
  }) => {
    appendTurnRecord(turn: SimplePomdpTurnRecordInput): Promise<void>;
    listRecentTurnRecords(input: {
      botId: string;
      threadId: string;
      limit: number;
    }): Promise<SimplePomdpTurnRecordInput[]>;
  };
} => {
  try {
    return require("@chat-agent/simple-pomdp-system");
  } catch {
    return require("../../../packages/simple-pomdp-system/lib");
  }
};
