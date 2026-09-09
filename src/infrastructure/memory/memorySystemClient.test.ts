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

test("routes PolicyCard lookup through unified memory search", async () => {
  const calls: unknown[] = [];
  const client = createMemorySystemClient(
    {
      postgresUrl: "postgres://example.invalid",
      ollamaBaseUrl: "http://ollama.invalid",
      ollamaModel: "stub",
    },
    () => ({
      ingestTurnRecord: async () => {},
      search: async (input) => {
        calls.push(input);
        return {
          policyCards: {
            status: "found",
            data: [
              {
                policyCardId: "pc-1",
                appliesWhen: "User compares options.",
                recommendedBehavior: "Compare constraints.",
              },
            ],
          },
        };
      },
      rememberUserNote: async () => ({ ok: true }),
      searchUserNotes: async () => [],
      replaceUserNote: async () => ({ ok: true }),
      deleteUserNote: async () => true,
    }),
  );

  const cards = await client.searchPolicyCards({
    botId: "ao",
    threadId: "thread-1",
    userId: "user-1",
    query: "deployment strategy",
    limit: 2,
  });

  expect(cards).toHaveLength(1);
  expect(calls).toEqual([
    {
      botId: "ao",
      threadId: "thread-1",
      userId: "user-1",
      query: "deployment strategy",
      scopes: ["policy_cards"],
      limits: { policy_cards: 2 },
    },
  ]);
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
      searchUserNotes: async (input) => {
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
  await client.searchUserNotes("shared-user", "concise", 5);
  await client.replaceUserNote("shared-user", 7, "Prefer detailed answers");
  await client.deleteUserNote("shared-user", 7);

  expect(calls).toEqual([
    { userId: "shared-user", note: "Prefer concise answers" },
    { userId: "shared-user", query: "concise", limit: 5 },
    { userId: "shared-user", noteId: 7, note: "Prefer detailed answers" },
    { userId: "shared-user", noteId: 7 },
  ]);
});
