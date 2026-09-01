import { QueueApi, QueueTask } from "@chat-agent/queue";
import { DiscordBotApp, DiscordTransport } from "./discordBotApp";
import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";
import { TurnRecordInput } from "../../infrastructure/memory/memorySystemClient";

const FIXED_NOW = "2026-05-08T00:00:00.000Z";

const formatUserMessage = (message: string): string =>
  `Current time: ${FIXED_NOW}\n\nUser message:\n${message}`;

const mergeUserMessages = (...messages: string[]): string =>
  messages.reduce((combined, message) =>
    combined.length === 0
      ? formatUserMessage(message)
      : `${combined}\n\nAdditional user message:\n${formatUserMessage(message)}`,
  "");

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

class RuntimeStub implements AgentRuntime {
  public readonly started: string[] = [];
  public readonly finished: string[] = [];
  public readonly systemPrompts: string[] = [];
  public readonly requestContexts: Array<string | undefined> = [];
  public readonly userIds: string[] = [];
  private readonly blockers = new Map<string, Promise<void>>();
  private readonly releases = new Map<string, () => void>();

  block(content: string): void {
    this.blockers.set(
      content,
      new Promise<void>((resolve) => {
        this.releases.set(content, resolve);
      }),
    );
  }

  release(content: string): void {
    this.releases.get(content)?.();
  }

  async respond(request: {
    userId: string;
    systemPrompt: string;
    requestContext?: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ content: string }> {
    this.systemPrompts.push(request.systemPrompt);
    this.requestContexts.push(request.requestContext);
    this.userIds.push(request.userId);
    const content = request.messages.at(-1)?.content ?? "";
    this.started.push(content);
    const blocker = this.blockers.get(content);
    if (blocker) {
      await blocker;
    }
    this.finished.push(content);
    return { content: `bot response: ${content}` };
  }
}

class TransportStub implements DiscordTransport {
  private messageHandler: ((message: ChannelMessage) => Promise<void>) | null = null;
  public readonly sent: Array<{ channelId: string; content: string }> = [];
  public readonly typing: string[] = [];

  onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    this.sent.push({ channelId, content });
  }

  async sendTyping(channelId: string): Promise<void> {
    this.typing.push(channelId);
  }

  async emit(message: ChannelMessage): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("handler is not registered");
    }
    await this.messageHandler(message);
  }
}

const identity: BotIdentity = {
  botId: "bot-discord",
  systemPrompt: "You are helpful",
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  jest.useRealTimers();
});

test("replies when mentioned", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(runtime.started).toEqual([formatUserMessage("@bot hi")]);
  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("@bot hi")}`);
  expect(transport.typing[0]).toBe("mention-channel");
});

test("records turn when mention reply is sent", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const records: string[] = [];
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    undefined,
    undefined,
    async (record) => {
      records.push(record.threadId);
    },
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(records).toEqual(["mention-channel:user-1"]);
});



test("records each visible turn once during a multi-turn conversation", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const records: TurnRecordInput[] = [];
  const app = new DiscordBotApp(identity, runtime, transport, "mention-channel", undefined, undefined, async (record) => { records.push(record); });
  app.start();
  await transport.emit({ channelId: "mention-channel", authorId: "user-1", content: "first", mentionsBot: true });
  await transport.emit({ channelId: "mention-channel", authorId: "user-1", content: "second", mentionsBot: true });
  expect(records).toHaveLength(2);
  expect(records.map((record) => ({ threadId: record.threadId, kind: record.kind, messages: record.messages.map(({ role, content }) => ({ role, content })) }))).toEqual([
    { threadId: "mention-channel:user-1", kind: "human", messages: [{ role: "user", content: formatUserMessage("first") }, { role: "assistant", content: "bot response: " + formatUserMessage("first") }] },
    { threadId: "mention-channel:user-1", kind: "human", messages: [{ role: "user", content: formatUserMessage("second") }, { role: "assistant", content: "bot response: " + formatUserMessage("second") }] },
  ]);
});

test("still replies when turn recording fails", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    undefined,
    undefined,
    async () => {
      throw new Error("record failed");
    },
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("@bot hi")}`);
});

test("injects memory policy context into system prompt when resolver returns cards", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    undefined,
    undefined,
    undefined,
    async () => "1. policy title\n- recommendedBehavior: do x",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  const usedContext = runtime.requestContexts[0] ?? "";
  expect(usedContext).toContain("policy title");
  expect(runtime.systemPrompts[0]).toBe(identity.systemPrompt);
});

test("still replies when policy resolver fails", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    undefined,
    undefined,
    undefined,
    async () => {
      throw new Error("policy resolve failed");
    },
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("@bot hi")}`);
  expect(runtime.systemPrompts[0]).toBe(identity.systemPrompt);
});

test("injects memory policy context for scheduled agent input", async () => {
  const task: QueueTask = {
    id: "scheduled-1",
    type: "scheduled_once",
    action: "agent_input",
    text: "scheduled check-in",
    channelId: "mention-channel",
    userId: "user-1",
    targetThreadId: "mention-channel:user-1",
    conversationVersion: 0,
    source: "scheduled",
    sourceInteractionId: "interaction-1",
    dueAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    locked: false,
  };
  const readyTasks: QueueTask[] = [task];
  let latestConversationVersion = 0;

  const queue: QueueApi = {
    enqueueMention: async (input) => {
      latestConversationVersion += 1;
      const mentionTask = {
        id: "human-1",
        type: "user" as const,
        action: "mention" as const,
        text: input.text,
        channelId: input.channelId,
        userId: input.userId,
        targetThreadId: `${input.channelId}:${input.userId}`,
        conversationVersion: latestConversationVersion,
        source: "user" as const,
        dueAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        locked: false,
        authorId: input.userId,
        mentionsBot: input.mentionsBot,
      };
      readyTasks.push(mentionTask);
      return mentionTask;
    },
    enqueueConversationInput: async () => task,
    enqueueScheduledInput: async () => task,
    dequeueReady: async () => readyTasks.shift() ?? null,
    ack: async () => undefined,
    release: async () => undefined,
    getStatus: async () => ({
      now: new Date().toISOString(),
      counts: {
        total: 0,
        locked: 0,
        byType: {
          user: 0,
          scheduled_recurring: 0,
          scheduled_once: 0,
        },
        readyByType: {
          user: 0,
          scheduled_recurring: 0,
          scheduled_once: 0,
        },
      },
      next: [],
    }),
    getLatestConversationVersion: async () => latestConversationVersion,
  };

  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const records: TurnRecordInput[] = [];
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    queue,
    undefined,
    async (record) => { records.push(record); },
    async () => "1. scheduled policy\n- recommendedBehavior: follow up",
  );

  app.start();
  await flushMicrotasks();
  await flushMicrotasks();

  expect(runtime.requestContexts[0]).toContain("scheduled policy");
  expect(runtime.userIds[0]).toBe("user-1");
  expect(transport.sent[0]?.content).toBe("bot response: scheduled check-in");
  expect(records[0]).toMatchObject({ kind: "proactive", sourceInteractionId: "interaction-1" });

  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "that sounds useful",
    mentionsBot: true,
  });
  await flushMicrotasks();
  await flushMicrotasks();

  expect(records[1]).toMatchObject({
    kind: "human",
    sourceInteractionId: "interaction-1",
  });
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "a separate follow-up",
    mentionsBot: true,
  });
  await flushMicrotasks();
  await flushMicrotasks();
  expect(records[2]?.sourceInteractionId).toBeUndefined();
});

test("strips leading discord mention before sending input to the agent", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    "1234567890",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "<@1234567890>\nこんにちは",
    mentionsBot: true,
  });

  expect(runtime.started).toEqual([formatUserMessage("こんにちは")]);
  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("こんにちは")}`);
});

test("integrates a conversation topic into one reply and links its next reaction", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const records: TurnRecordInput[] = [];
  const planned: string[] = [];
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    undefined,
    undefined,
    async (record) => {
      records.push(record);
    },
    undefined,
    async ({ userId }) => {
      planned.push(userId);
      return {
        text: "回答の末尾で実装の話題へ自然につなげる",
        sourceInteractionId: "conversation-1",
      };
    },
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "設計の選択肢を比較して",
    mentionsBot: true,
  });

  expect(transport.sent).toHaveLength(1);
  expect(runtime.requestContexts[0]).toContain("# Conversation Topic Integration");
  expect(runtime.requestContexts[0]).toContain("実装の話題へ自然につなげる");
  expect(records[0]).toMatchObject({
    kind: "human",
    sourceInteractionId: "conversation-1",
  });

  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "その話は興味があります",
    mentionsBot: true,
  });

  expect(planned).toEqual(["user-1"]);
  expect(transport.sent).toHaveLength(2);
  expect(records[1]).toMatchObject({
    kind: "human",
    sourceInteractionId: "conversation-1",
  });
});

test.each(["了解", "エラーになりました", "そこは違うので訂正して"])(
  "does not plan a conversation topic for excluded input: %s",
  async (content) => {
    const transport = new TransportStub();
    const runtime = new RuntimeStub();
    const planned: string[] = [];
    const app = new DiscordBotApp(
      identity,
      runtime,
      transport,
      "mention-channel",
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        planned.push(content);
        return {
          text: "unused",
          sourceInteractionId: "conversation-1",
        };
      },
    );

    app.start();
    await transport.emit({
      channelId: "mention-channel",
      authorId: "user-1",
      content,
      mentionsBot: true,
    });

    expect(planned).toHaveLength(0);
    expect(transport.sent).toHaveLength(1);
  },
);

test("strips leading discord nickname mention before sending input to the agent", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    "1234567890",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "<@!1234567890> こんにちは",
    mentionsBot: true,
  });

  expect(runtime.started).toEqual([formatUserMessage("こんにちは")]);
  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("こんにちは")}`);
});

test("does not reply mention outside mention channel", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  await transport.emit({
    channelId: "other-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(transport.sent).toHaveLength(0);
});

test("does not react outside mention channel", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  await transport.emit({
    channelId: "other-channel",
    authorId: "user-1",
    content: "hello",
    mentionsBot: false,
  });

  expect(transport.sent).toHaveLength(0);
});

test("does not type or reply when message in mention channel does not mention this bot", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@other-bot hi",
    mentionsBot: false,
  });

  expect(runtime.started).toEqual([]);
  expect(transport.typing).toEqual([]);
  expect(transport.sent).toEqual([]);
});

test("does not block reply when sendTyping does not resolve", async () => {
  class SlowTypingTransport extends TransportStub {
    override async sendTyping(channelId: string): Promise<void> {
      this.typing.push(channelId);
      await new Promise<void>(() => {
        // Intentionally never resolves.
      });
    }
  }

  const transport = new SlowTypingTransport();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "@bot hi",
    mentionsBot: true,
  });

  expect(transport.typing[0]).toBe("mention-channel");
  expect(transport.sent[0]?.content).toBe(`bot response: ${formatUserMessage("@bot hi")}`);
});

test("discards a stale response and replans once with all newer user input", async () => {
  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  runtime.block(formatUserMessage("first"));

  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
  );

  app.start();
  const firstEmit = transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "first",
    mentionsBot: true,
  });
  await flushMicrotasks();
  const secondEmit = transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "second",
    mentionsBot: false,
  });
  await flushMicrotasks();
  const thirdEmit = transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "third",
    mentionsBot: false,
  });
  await flushMicrotasks();

  expect(runtime.started).toEqual([formatUserMessage("first")]);
  expect(runtime.finished).toEqual([]);
  expect(transport.sent).toHaveLength(0);

  runtime.release(formatUserMessage("first"));
  await firstEmit;
  await secondEmit;
  await thirdEmit;

  const mergedInput = mergeUserMessages("first", "second", "third");
  expect(runtime.started).toEqual([
    formatUserMessage("first"),
    mergedInput,
  ]);
  expect(runtime.finished).toEqual([
    formatUserMessage("first"),
    mergedInput,
  ]);
  expect(transport.sent).toEqual([
    {
      channelId: "mention-channel",
      content: `bot response: ${mergedInput}`,
    },
  ]);
});

test("does not send a duplicate reply when ack fails after a successful response", async () => {
  const task: QueueTask = {
    id: "q1",
    type: "user",
    action: "mention",
    text: formatUserMessage("first"),
    channelId: "mention-channel",
    userId: "user-1",
    targetThreadId: "mention-channel:user-1",
    conversationVersion: 1,
    source: "user",
    authorId: "user-1",
    mentionsBot: true,
    dueAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    locked: false,
  };
  let dequeueCount = 0;

  const queue: QueueApi = {
    enqueueMention: async () => task,
    enqueueConversationInput: async () => {
      throw new Error("not used");
    },
    enqueueScheduledInput: async () => {
      throw new Error("not used");
    },
    dequeueReady: async () => {
      dequeueCount += 1;
      return dequeueCount === 1 ? { ...task, locked: true } : null;
    },
    ack: async () => {
      throw new Error("ack failed");
    },
    release: async () => {
      throw new Error("release must not be called");
    },
    getStatus: async () => ({
      now: new Date().toISOString(),
      counts: {
        total: 0,
        locked: 0,
        byType: {
          user: 0,
          scheduled_recurring: 0,
          scheduled_once: 0,
        },
        readyByType: {
          user: 0,
          scheduled_recurring: 0,
          scheduled_once: 0,
        },
      },
      next: [],
    }),
    getLatestConversationVersion: async () => 1,
  };

  const transport = new TransportStub();
  const runtime = new RuntimeStub();
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    "mention-channel",
    queue,
  );

  app.start();
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "first",
    mentionsBot: true,
  });
  await transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "ignored-after-ack-failure",
    mentionsBot: true,
  });

  expect(transport.sent).toEqual([
    {
      channelId: "mention-channel",
      content: `bot response: ${formatUserMessage("first")}`,
    },
  ]);
});
