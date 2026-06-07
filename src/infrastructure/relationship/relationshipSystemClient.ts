type ChatRole = "system" | "user" | "assistant";

interface TurnMessage {
  role: ChatRole;
  content: string;
  timestampIso: string;
}

export interface RelationshipTurnRecordInput {
  botId: string;
  threadId: string;
  messages: TurnMessage[];
  createdAtIso: string;
}

interface RelationshipSystemService {
  ingestTurnRecord(input: RelationshipTurnRecordInput): Promise<void>;
}

export interface RelationshipSystemClient {
  ingestTurnRecord(input: RelationshipTurnRecordInput): Promise<void>;
}

export interface RelationshipSystemClientOptions {
  turnRecordDir: string;
  maxTurnsPerThread?: number;
}

export const createRelationshipSystemClient = (
  options: RelationshipSystemClientOptions,
): RelationshipSystemClient => {
  const service = loadRelationshipSystemService(options);
  return {
    ingestTurnRecord: async (input) => {
      if (!service) {
        return;
      }
      await service.ingestTurnRecord(input);
    },
  };
};

const loadRelationshipSystemService = (
  options: RelationshipSystemClientOptions,
): RelationshipSystemService | null => {
  try {
    const mod = require("@chat-agent/relationship-system") as {
      createRelationshipSystemService?: (params: {
        turnRecordStore: {
          appendTurnRecord(turn: RelationshipTurnRecordInput): Promise<void>;
          listRecentTurnRecords(input: {
            botId: string;
            threadId: string;
            limit: number;
          }): Promise<RelationshipTurnRecordInput[]>;
        };
      }) => RelationshipSystemService;
      createFileRelationshipTurnRecordStore?: (params: {
        baseDir: string;
        maxTurnsPerThread?: number;
      }) => {
        appendTurnRecord(turn: RelationshipTurnRecordInput): Promise<void>;
        listRecentTurnRecords(input: {
          botId: string;
          threadId: string;
          limit: number;
        }): Promise<RelationshipTurnRecordInput[]>;
      };
    };
    if (
      !mod.createRelationshipSystemService ||
      !mod.createFileRelationshipTurnRecordStore
    ) {
      process.stdout.write(
        "[relationship-system] required exports not found; relationship ingest is disabled\n",
      );
      return null;
    }
    return mod.createRelationshipSystemService({
      turnRecordStore: mod.createFileRelationshipTurnRecordStore({
        baseDir: options.turnRecordDir,
        ...(options.maxTurnsPerThread !== undefined
          ? { maxTurnsPerThread: options.maxTurnsPerThread }
          : {}),
      }),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stdout.write(
      `[relationship-system] failed to load package; relationship ingest is disabled: ${message}\n`,
    );
    return null;
  }
};
