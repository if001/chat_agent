import { MemorySystemClient } from "../memory/memorySystemClient";
import { RequestContextBuilder } from "./requestContextBuilder";

const userMemoryStore = {
  searchUserNotes: async (userId: string) => [
    { id: 1, note: `shared note for ${userId}`, createdAt: new Date(0) },
  ],
};

const dailyEventRepository = {
  searchDailyEvents: async ({ userId }: { userId: string }) => [
    {
      id: 1,
      userId,
      eventDate: "2026-09-01",
      summary: "shared event",
      tags: [],
      createdAt: new Date(0),
    },
  ],
} as Pick<MemorySystemClient, "searchDailyEvents">;

test("builds fresh time and origin context without prefetching memory", async () => {
  const policyInputs: string[] = [];
  let current = new Date("2026-09-01T00:00:00.000Z");
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    {
      load: async ({ botId }) => {
        policyInputs.push(botId);
        return `policy for ${botId}`;
      },
    },
    () => current,
  );

  const first = await builder.build({
    botId: "ao",
    userId: "discord-1",
    threadId: "thread-1",
    currentContext: "hello",
    kind: "human",
  });
  current = new Date("2026-09-01T01:00:00.000Z");
  const second = await builder.build({
    botId: "aka",
    userId: "discord-1",
    threadId: "thread-1",
    currentContext: "hello again",
    kind: "human",
  });

  expect(first).toContain("2026-09-01T00:00:00.000Z");
  expect(second).toContain("2026-09-01T01:00:00.000Z");
  expect(first).toContain("Input origin: human");
  expect(first).not.toContain("shared note for discord-1");
  expect(second).not.toContain("shared event");
  expect(first).not.toContain("policy for ao");
  expect(second).not.toContain("policy for aka");
  expect(policyInputs).toEqual([]);
});

test("loads daily events only for temporal requests", async () => {
  const queries: string[] = [];
  const builder = new RequestContextBuilder(
    userMemoryStore,
    {
      searchDailyEvents: async ({ query }) => {
        queries.push(query);
        return [{ id: 1, userId: "discord-1", eventDate: "2026-09-01", summary: "shared event", tags: [], createdAt: new Date(0) }];
      },
    } as Pick<MemorySystemClient, "searchDailyEvents">,
    { load: async () => undefined },
  );

  const ordinary = await builder.build({ botId: "ao", userId: "discord-1", threadId: "t", currentContext: "設計について相談したい", kind: "human" });
  const temporal = await builder.build({ botId: "ao", userId: "discord-1", threadId: "t", currentContext: "昨日は何をした？", kind: "human" });

  expect(ordinary).not.toContain("shared event");
  expect(temporal).not.toContain("shared event");
  expect(queries).toEqual([]);
});

test("injects only lightweight shared article candidates for knowledge requests", async () => {
  const queries: string[] = [];
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => undefined },
    () => new Date("2026-09-01T00:00:00.000Z"),
    undefined,
    {
      searchRelevant: async ({ query }) => {
        queries.push(query);
        return [{ articleId: "article-1", title: "共有記事", summary: "要約", tags: ["agent"], url: "https://example.com/article" }];
      },
    },
  );

  const greeting = await builder.build({ botId: "ao", userId: "u", threadId: "t", currentContext: "こんにちは", kind: "human" });
  const question = await builder.build({ botId: "aka", userId: "u", threadId: "t", currentContext: "以前共有したagentの記事について教えて？", kind: "human" });

  expect(greeting).not.toContain("Relevant Shared Articles");
  expect(question).not.toContain("articleId=article-1");
  expect(question).not.toContain("rawMarkdown");
  expect(queries).toEqual([]);
});

test("marks relevant shared article retrieval failures without failing the request", async () => {
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => undefined },
    undefined,
    undefined,
    { searchRelevant: async () => { throw new Error("temporary backend failure"); } },
  );
  const context = await builder.build({ botId: "ao", userId: "u", threadId: "t", currentContext: "共有した記事の内容を教えて？", kind: "human" });
  expect(context).not.toContain("Relevant saved articles could not be checked");
});

test("includes proactive evidence only for proactive requests", async () => {
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => undefined },
    () => new Date("2026-09-01T00:00:00.000Z"),
  );
  const base = {
    botId: "ao",
    userId: "discord-1",
    threadId: "thread-1",
    currentContext: "hello",
    proactiveEvidence: "internal proactive objective",
  };

  const human = await builder.build({ ...base, kind: "human" });
  const conversation = await builder.build({ ...base, kind: "conversation" });
  const proactive = await builder.build({ ...base, kind: "proactive" });

  expect(human).not.toContain("internal proactive objective");
  expect(conversation).toContain("internal proactive objective");
  expect(proactive).toContain("internal proactive objective");
});

test("loads conversation focus from the latest request context", async () => {
  const focusInputs: string[] = [];
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => undefined },
    () => new Date("2026-09-01T00:00:00.000Z"),
    {
      analyze: async ({ currentContext }) => {
        focusInputs.push(currentContext);
        return {
          focus: {
            currentTopic: currentContext,
            currentTopicReason: "latest input establishes the topic",
            currentTopicStatus: "active",
            currentTopicStatusReason: "the topic is still active",
          },
          reason: "test analysis",
          conversationTrigger: "ineligible",
          conversationTriggerReason: "test analysis",
        };
      },
    },
  );

  const context = await builder.build({
    botId: "ao",
    userId: "discord-1",
    threadId: "thread-1",
    currentContext: "latest merged input",
    kind: "human",
  });

  expect(focusInputs).toEqual(["latest merged input"]);
  expect(context).toContain("## Conversation Focus");
  expect(context).toContain("currentTopic: latest merged input");
});

test("uses precomputed focus without a duplicate analysis call", async () => {
  let calls = 0;
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => undefined },
    () => new Date("2026-09-01T00:00:00.000Z"),
    {
      analyze: async () => {
        calls += 1;
        return {
          focus: null,
          reason: "should not run",
          conversationTrigger: "ineligible",
          conversationTriggerReason: "should not run",
        };
      },
    },
  );

  const context = await builder.build({
    botId: "ao",
    userId: "discord-1",
    threadId: "thread-1",
    currentContext: "latest input",
    kind: "human",
    conversationFocus: {
      currentTopic: "precomputed topic",
      currentTopicReason: "precomputed focus reason",
      currentTopicStatus: "active",
      currentTopicStatusReason: "precomputed status reason",
    },
  });

  expect(calls).toBe(0);
  expect(context).toContain("currentTopic: precomputed topic");
});

test("omits prefetched memory and keeps time, origin, and proactive metadata", async () => {
  const builder = new RequestContextBuilder(
    { searchUserNotes: async () => { throw new Error("must not prefetch user memory"); } },
    { searchDailyEvents: async () => { throw new Error("must not prefetch daily events"); } },
    { load: async () => { throw new Error("must not prefetch policies"); } },
    () => new Date("2026-09-09T00:00:00.000Z"),
    undefined,
    { searchRelevant: async () => { throw new Error("must not prefetch knowledge"); } },
  );

  const context = await builder.build({
    botId: "ao",
    userId: "user-1",
    threadId: "thread-1",
    currentContext: "remember the earlier topic",
    kind: "proactive",
    proactiveEvidence: "follow up on the saved plan",
  });

  expect(context).toContain("Current time: 2026-09-09T00:00:00.000Z");
  expect(context).toContain("Input origin: proactive");
  expect(context).toContain("follow up on the saved plan");
  expect(context).not.toMatch(/Shared UserMemory|Shared DailyEvent|PolicyCard|Shared Articles/);
});
