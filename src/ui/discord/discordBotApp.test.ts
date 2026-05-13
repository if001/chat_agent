import { DiscordBotApp, DiscordTransport } from "./discordBotApp";
import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";
import { QueueStore, QueueTask } from "../../queue/types";

const FIXED_NOW = "2026-05-08T00:00:00.000Z";

const formatUserMessage = (message: string): string =>
  `Current time: ${FIXED_NOW}\n\nUser message:\n${message}`;

class RuntimeStub implements AgentRuntime {
  public readonly started: string[] = [];
  public readonly finished: string[] = [];
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
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ content: string }> {
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

test("processes later queued user input after the current reply finishes", async () => {
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
  await Promise.resolve();
  const secondEmit = transport.emit({
    channelId: "mention-channel",
    authorId: "user-1",
    content: "second",
    mentionsBot: true,
  });
  await Promise.resolve();

  expect(runtime.started).toEqual([formatUserMessage("first")]);
  expect(runtime.finished).toEqual([]);
  expect(transport.sent).toHaveLength(0);

  runtime.release(formatUserMessage("first"));
  await firstEmit;
  await secondEmit;

  expect(runtime.started).toEqual([
    formatUserMessage("first"),
    formatUserMessage("second"),
  ]);
  expect(runtime.finished).toEqual([
    formatUserMessage("first"),
    formatUserMessage("second"),
  ]);
  expect(transport.sent).toEqual([
    {
      channelId: "mention-channel",
      content: `bot response: ${formatUserMessage("first")}`,
    },
    {
      channelId: "mention-channel",
      content: `bot response: ${formatUserMessage("second")}`,
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
    authorId: "user-1",
    mentionsBot: true,
    dueAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    locked: false,
  };
  let dequeueCount = 0;

  const queue: QueueStore = {
    enqueue: async () => task,
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
