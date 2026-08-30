describe("createSimplePomdpSystemClient", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("loads package store and forwards turn records", async () => {
    const appendTurnRecord = jest.fn(async () => {});

    jest.doMock(
      "@chat-agent/simple-pomdp-system",
      () => ({
        createFileTurnRecordStore: () => ({
          appendTurnRecord,
          listRecentTurnRecords: async () => [],
        }),
        createSimplePomdpSystemService: ({
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

    const { createSimplePomdpSystemClient } = require("./simplePomdpSystemClient") as typeof import("./simplePomdpSystemClient");

    const client = createSimplePomdpSystemClient({
      storeDir: "data/simple-pomdp-system",
    });

    await client.ingestTurnRecord({
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-06-14T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "こんにちは",
          timestampIso: "2026-06-14T00:00:00.000Z",
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
