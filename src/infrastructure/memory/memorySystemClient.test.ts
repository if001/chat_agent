import {
  createMemorySystemClient,
  formatPolicyCardsForPrompt,
} from "./memorySystemClient";

test("formats policy context with explicit applicability and behaviors", () => {
  const prompt = formatPolicyCardsForPrompt([
    {
      policyCardId: "pc-1",
      appliesWhen: "User compares implementation options.",
      recommendedBehavior: "Compare tradeoffs against constraints.",
      avoidBehavior: "Do not choose before confirming constraints.",
    },
  ]);

  expect(prompt).toContain(
    "appliesWhen: User compares implementation options.",
  );
  expect(prompt).toContain(
    "recommendedBehavior: Compare tradeoffs against constraints.",
  );
  expect(prompt).toContain(
    "avoidBehavior: Do not choose before confirming constraints.",
  );
  expect(prompt).not.toContain("episodeIds");
});

test("routes UserMemory operations through the memory-system service", async () => {
  const calls: unknown[] = [];
  const client = createMemorySystemClient(
    {
      postgresUrl: "postgres://example.invalid",
      ollamaBaseUrl: "http://ollama.invalid",
      ollamaModel: "stub",
    },
    () => ({
      ingestTurnRecord: async () => {},
      search: async () => ({}),
      rememberUserNote: async (input) => {
        calls.push(input);
        return { ok: true, action: "create" };
      },
      findUserNotesForManagement: async (input) => {
        calls.push(input);
        return [];
      },
      replaceUserNote: async (input) => {
        calls.push(input);
        return { ok: true, action: "replace" };
      },
      deleteUserNote: async (input) => {
        calls.push(input);
        return true;
      },
    }),
  );

  await client.rememberUserNote("shared-user", "Prefer concise answers");
  await client.findUserNotesForManagement("shared-user", "concise", 5);
  await client.replaceUserNote("shared-user", 7, "Prefer detailed answers");
  await client.deleteUserNote("shared-user", 7);

  expect(calls).toEqual([
    { userId: "shared-user", note: "Prefer concise answers" },
    { userId: "shared-user", query: "concise", limit: 5 },
    { userId: "shared-user", noteId: 7, note: "Prefer detailed answers" },
    { userId: "shared-user", noteId: 7 },
  ]);
});

test("routes DailyEvent writes directly and reads through unified search", async () => {
  const calls: unknown[] = [];
  const client = createMemorySystemClient(
    {
      postgresUrl: "postgres://example.invalid",
      ollamaBaseUrl: "http://ollama.invalid",
      ollamaModel: "stub",
    },
    () => ({
      ingestTurnRecord: async () => {},
      queryApplicablePolicyCards: async () => [],
      rememberUserNote: async () => ({ ok: true }),
      findUserNotesForManagement: async () => [],
      replaceUserNote: async () => ({ ok: true }),
      deleteUserNote: async () => true,
      rememberDailyEvent: async (input) => {
        calls.push(input);
        return {
          id: 1,
          userId: input.userId,
          eventDate: input.eventDate,
          summary: input.summary,
          tags: input.tags ?? [],
          createdAt: new Date("2026-09-09T00:00:00.000Z"),
        };
      },
      search: async (input) => {
        calls.push(input);
        return { dailyEvents: { status: "not_found" as const } };
      },
    }),
  );

  await client.rememberDailyEvent({
    userId: "shared-user",
    eventDate: "2026-09-09",
    summary: "queue tests completed",
  });
  await client.searchMemory({
    botId: "ao",
    threadId: "thread-1",
    userId: "shared-user",
    query: "queue",
    scopes: ["daily_events"],
    filters: {
      dailyEvents: { from: "2026-09-01", to: "2026-09-30" },
    },
  });

  expect(calls).toEqual([
    {
      userId: "shared-user",
      eventDate: "2026-09-09",
      summary: "queue tests completed",
    },
    {
      botId: "ao",
      threadId: "thread-1",
      userId: "shared-user",
      query: "queue",
      scopes: ["daily_events"],
      filters: {
        dailyEvents: { from: "2026-09-01", to: "2026-09-30" },
      },
    },
  ]);
});

test("catalog and scoped search preserve unavailable when the service cannot load", async () => {
  const client = createMemorySystemClient(
    {
      postgresUrl: "postgres://example.invalid",
      ollamaBaseUrl: "http://ollama.invalid",
      ollamaModel: "stub",
    },
    () => null,
  );

  const catalog = await client.inspectCatalog({
    botId: "ao",
    threadId: "thread-1",
    userId: "user-1",
  });
  const result = await client.searchMemory({
    botId: "ao",
    threadId: "thread-1",
    userId: "user-1",
    query: "music",
    scopes: ["user_memory"],
  });

  expect(catalog.status).toBe("unavailable");
  expect(catalog.userMemory.status).toBe("unavailable");
  expect(result.userMemory).toEqual({
    status: "unavailable",
    reason: "memory-system is unavailable",
  });
});
