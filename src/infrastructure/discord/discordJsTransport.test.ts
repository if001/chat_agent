import { DiscordJsTransport } from "./discordJsTransport";

interface HandlerMap {
  messageCreate?: (message: {
    content: string;
    author: { id: string; bot: boolean };
    channel: { id: string; send(content: string): Promise<void> };
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

  transport.onMessage(async (message) => {
    expect(message.mentionsBot).toBe(true);
    await transport.sendMessage(message.channelId, "reply");
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
    },
    mentions: { has: (userId: string) => userId === "bot-1" },
  });

  expect(sent[0]).toBe("reply");
});
