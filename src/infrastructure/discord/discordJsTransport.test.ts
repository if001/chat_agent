import { DiscordJsTransport } from "./discordJsTransport";

interface HandlerMap {
  messageCreate?: (message: {
    content: string;
    author: { id: string; bot: boolean };
    channel: { id: string; send(content: string): Promise<void>; sendTyping(): Promise<void> };
    mentions: { has(userId: string): boolean };
  }) => Promise<void> | void;
}

class FakeClient {
  public user: { id: string } | null = { id: "bot-1" };
  public readonly handlers: HandlerMap = {};

  on(event: "messageCreate", handler: HandlerMap["messageCreate"]): void {
    this.handlers[event] = handler;
  }
}

test("forwards mention and sends response", async () => {
  const client = new FakeClient();
  const transport = new DiscordJsTransport(client);
  const sent: string[] = [];
  let typingCount = 0;

  transport.onMessage(async (message) => {
    expect(message.mentionsBot).toBe(true);
    await transport.sendMessage(message.channelId, "reply");
    await transport.sendTyping(message.channelId);
  });

  const handler = client.handlers.messageCreate;
  if (!handler) {
    throw new Error("handler not found");
  }

  await handler({
    content: "hello",
    author: { id: "u1", bot: false },
    channel: {
      id: "c1",
      send: async (content: string) => {
        sent.push(content);
      },
      sendTyping: async () => {
        typingCount += 1;
      },
    },
    mentions: { has: (userId: string) => userId === "bot-1" },
  });

  expect(sent[0]).toBe("reply");
  expect(typingCount).toBe(1);
});

test("ignores bot-authored message when bot id is not allowlisted", async () => {
  const client = new FakeClient();
  const transport = new DiscordJsTransport(client);
  let called = false;

  transport.onMessage(async () => {
    called = true;
  });

  const handler = client.handlers.messageCreate;
  if (!handler) {
    throw new Error("handler not found");
  }

  await handler({
    content: "<@bot-1> hello",
    author: { id: "bot-2", bot: true },
    channel: {
      id: "c1",
      send: async () => {},
      sendTyping: async () => {},
    },
    mentions: { has: (userId: string) => userId === "bot-1" },
  });

  expect(called).toBe(false);
});

test("forwards bot-authored message when bot id is allowlisted", async () => {
  const client = new FakeClient();
  const transport = new DiscordJsTransport(client, ["bot-2"]);
  let called = false;

  transport.onMessage(async (message) => {
    called = true;
    expect(message.authorId).toBe("bot-2");
    expect(message.mentionsBot).toBe(true);
  });

  const handler = client.handlers.messageCreate;
  if (!handler) {
    throw new Error("handler not found");
  }

  await handler({
    content: "<@bot-1> hello",
    author: { id: "bot-2", bot: true },
    channel: {
      id: "c1",
      send: async () => {},
      sendTyping: async () => {},
    },
    mentions: { has: (userId: string) => userId === "bot-1" },
  });

  expect(called).toBe(true);
});
