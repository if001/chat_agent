describe("createRelationshipSystemClient", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("loads package store and forwards turn records", async () => {
    const appendTurnRecord = jest.fn(async () => {});

    jest.doMock(
      "@chat-agent/relationship-system",
      () => ({
        createFileRelationshipTurnRecordStore: () => ({
          appendTurnRecord,
          listRecentTurnRecords: async () => [],
        }),
        createRelationshipSystemService: ({
          turnRecordStore,
        }: {
          turnRecordStore: {
            appendTurnRecord(turn: unknown): Promise<void>;
          };
        }) => ({
          ingestTurnRecord: async (input: unknown) => {
            await turnRecordStore.appendTurnRecord(input);
          },
        }),
      }),
      { virtual: true },
    );

    const { createRelationshipSystemClient } = require("./relationshipSystemClient") as typeof import("./relationshipSystemClient");

    const client = createRelationshipSystemClient({
      turnRecordDir: "data/relationship-system",
    });

    await client.ingestTurnRecord({
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-05-29T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "こんにちは",
          timestampIso: "2026-05-29T00:00:00.000Z",
        },
      ],
    });

    expect(appendTurnRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "ao",
        threadId: "thread-1",
      }),
    );
  });
});
