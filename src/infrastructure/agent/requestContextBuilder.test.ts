import { DailyEventRepository, UserMemoryStore } from "../../core/types";
import { RequestContextBuilder } from "./requestContextBuilder";

const userMemoryStore = {
  searchUserNotes: async (userId: string) => [
    { id: 1, note: `shared note for ${userId}`, createdAt: new Date(0) },
  ],
} as UserMemoryStore;

const dailyEventRepository = {
  searchDailyEvents: async ({ userId }: { userId: string }) => [
    {
      id: 1,
      botId: "shared",
      userId,
      eventDate: "2026-09-01",
      summary: "shared event",
      tags: [],
      createdAt: new Date(0),
    },
  ],
} as DailyEventRepository;

test("builds fresh shared context and bot-specific policy for every request", async () => {
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
  expect(first).toContain("shared note for discord-1");
  expect(second).toContain("shared event");
  expect(first).toContain("policy for ao");
  expect(second).toContain("policy for aka");
  expect(policyInputs).toEqual(["ao", "aka"]);
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
            currentTopicStatus: "active",
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
      currentTopicStatus: "active",
    },
  });

  expect(calls).toBe(0);
  expect(context).toContain("currentTopic: precomputed topic");
});
