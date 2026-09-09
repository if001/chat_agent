import {
  TERMINAL_THREAD_ID,
  TERMINAL_USER_ID,
  TerminalChatApp,
} from "./terminalChatApp";
import {
  AgentRequest,
  AgentRuntime,
  BotIdentity,
} from "../../core/types";
import { MemorySystemClient } from "../../infrastructure/memory/memorySystemClient";
import { RequestContextBuilder } from "../../infrastructure/agent/requestContextBuilder";
import { DeepAgentRuntime } from "../../infrastructure/agent/deepAgentRuntime";

class RuntimeStub implements AgentRuntime {
  public lastContent = "";
  public lastSystemPrompt = "";
  public readonly requests: AgentRequest[] = [];

  async respond(request: AgentRequest): Promise<{ content: string }> {
    this.requests.push(request);
    this.lastContent = request.messages.at(-1)?.content ?? "";
    this.lastSystemPrompt = request.systemPrompt;
    return { content: "terminal answer" };
  }
}

const identity: BotIdentity = {
  botId: "bot-terminal",
  systemPrompt: "You are terminal bot",
};

test("returns runtime answer", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(identity, runtime);
  const result = await app.ask("hello");
  expect(result).toBe("terminal answer");
  expect(runtime.lastContent).toMatch(/^Current time: .*Z\n\nUser message:\nhello$/);
});

test("records turn after response", async () => {
  const runtime = new RuntimeStub();
  const records: Array<{ botId: string; threadId: string }> = [];
  const app = new TerminalChatApp(identity, runtime, async (record) => {
    records.push({ botId: record.botId, threadId: record.threadId });
  });
  await app.ask("hello");
  expect(records).toEqual([{ botId: "bot-terminal", threadId: "terminal:default" }]);
});

test("still returns answer when turn recording fails", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(identity, runtime, async () => {
    throw new Error("record failed");
  });
  const result = await app.ask("hello");
  expect(result).toBe("terminal answer");
});

test("keeps the system prompt static and does not prefetch policy context", async () => {
  const runtime = new RuntimeStub();
  const policyInputs: string[] = [];
  const builder = new RequestContextBuilder(
    emptyUserMemoryStore,
    emptyDailyEventRepository,
    {
      load: async ({ currentContext }) => {
        policyInputs.push(currentContext);
        return `policy: ${currentContext}`;
      },
    },
    () => new Date("2026-09-02T00:00:00.000Z"),
  );
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    (request) => builder.build(request),
  );
  await app.ask("first");
  await app.ask("second");

  expect(runtime.requests.map((request) => request.systemPrompt)).toEqual([
    identity.systemPrompt,
    identity.systemPrompt,
  ]);
  expect(runtime.requests[0]?.requestContext).not.toContain("PolicyCard");
  expect(runtime.requests[1]?.requestContext).not.toContain("PolicyCard");
  expect(policyInputs).toEqual([]);
});

test("still returns answer when request context resolver fails", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    async () => {
      throw new Error("context resolve failed");
    },
  );

  const result = await app.ask("hello");

  expect(result).toBe("terminal answer");
  expect(runtime.lastSystemPrompt).toBe(identity.systemPrompt);
  expect(runtime.requests[0]?.requestContext).toBeUndefined();
});

test("builds time and origin context without prefetched memory or focus", async () => {
  const runtime = new RuntimeStub();
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    { load: async () => "use explicit constraints" },
    () => new Date("2026-09-02T00:00:00.000Z"),
  );
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    (request) => builder.build(request),
  );

  await app.ask("continue");

  const context = runtime.requests[0]?.requestContext;
  expect(context).toContain("Current time: 2026-09-02T00:00:00.000Z");
  expect(context).toContain("Input origin: human");
  expect(context).not.toContain("prefers concise answers");
  expect(context).not.toContain("2026-09-03: release day");
  expect(context).not.toContain("use explicit constraints");
  expect(context).not.toContain("Conversation Focus");
});

test("passes stable trusted terminal identity and thread on every turn", async () => {
  const runtime = new RuntimeStub();
  const seenContexts: unknown[] = [];
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    async (context) => {
      seenContexts.push(context);
      return undefined;
    },
  );

  await app.ask("first");
  await app.ask("second");

  expect(seenContexts).toEqual([
    {
      botId: identity.botId,
      userId: TERMINAL_USER_ID,
      threadId: TERMINAL_THREAD_ID,
      currentContext: "first",
      kind: "human",
    },
    {
      botId: identity.botId,
      userId: TERMINAL_USER_ID,
      threadId: TERMINAL_THREAD_ID,
      currentContext: "second",
      kind: "human",
    },
  ]);
  expect(
    runtime.requests.map(({ botId, userId, threadId }) => ({
      botId,
      userId,
      threadId,
    })),
  ).toEqual([
    {
      botId: identity.botId,
      userId: TERMINAL_USER_ID,
      threadId: TERMINAL_THREAD_ID,
    },
    {
      botId: identity.botId,
      userId: TERMINAL_USER_ID,
      threadId: TERMINAL_THREAD_ID,
    },
  ]);
});

test("uses bot-scoped checkpoint threads and caches only static prompts", async () => {
  const createdPrompts: string[] = [];
  const checkpointThreads: string[] = [];
  const contexts: Array<string | undefined> = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    ({ systemPrompt }) => {
      createdPrompts.push(systemPrompt);
      return {
        invoke: async (request, config) => {
          checkpointThreads.push(config.configurable.thread_id);
          contexts.push(request.messages[0]?.content);
          return { messages: [{ role: "assistant", content: "ok" }] };
        },
      };
    },
    () => undefined,
    () => undefined,
  );
  const ao = new TerminalChatApp(
    { botId: "ao", systemPrompt: "static ao" },
    runtime,
    undefined,
    async ({ currentContext }) => `context: ${currentContext}`,
  );
  const aka = new TerminalChatApp(
    { botId: "aka", systemPrompt: "static aka" },
    runtime,
    undefined,
    async ({ currentContext }) => `context: ${currentContext}`,
  );

  await ao.ask("first");
  await ao.ask("second");
  await aka.ask("third");

  expect(createdPrompts).toEqual(["static ao", "static aka"]);
  expect(checkpointThreads).toEqual([
    `ao:${TERMINAL_THREAD_ID}`,
    `ao:${TERMINAL_THREAD_ID}`,
    `aka:${TERMINAL_THREAD_ID}`,
  ]);
  expect(contexts).toEqual([
    "context: first",
    "context: second",
    "context: third",
  ]);
});

const userMemoryStore = {
  rememberUserNote: async () => {
    throw new Error("not used");
  },
  searchUserNotes: async () => [
    { id: 1, note: "prefers concise answers", createdAt: new Date(0) },
  ],
  replaceUserNote: async () => null,
  deleteUserNote: async () => false,
};

const emptyUserMemoryStore = {
  ...userMemoryStore,
  searchUserNotes: async () => [],
};

const dailyEventRepository: Pick<MemorySystemClient, "searchDailyEvents"> = {
  rememberDailyEvent: async () => {
    throw new Error("not used");
  },
  searchDailyEvents: async () => [
    {
      id: 1,
      userId: TERMINAL_USER_ID,
      eventDate: "2026-09-03",
      summary: "release day",
      tags: [],
      createdAt: new Date(0),
    },
  ],
  getDailyEventsByDate: async () => [],
};

const emptyDailyEventRepository: Pick<MemorySystemClient, "searchDailyEvents"> = {
  ...dailyEventRepository,
  searchDailyEvents: async () => [],
};
