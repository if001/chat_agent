import { DiscordBotApp, DiscordTransport } from "./discordBotApp";
import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";

class RuntimeStub implements AgentRuntime {
  async respond(): Promise<{ content: string }> {
    return { content: "bot response" };
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

test("replies when mentioned", async () => {
  const transport = new TransportStub();
  const app = new DiscordBotApp(
    identity,
    new RuntimeStub(),
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

  expect(transport.sent[0]?.content).toBe("bot response");
  expect(transport.typing[0]).toBe("mention-channel");
});

test("does not reply mention outside mention channel", async () => {
  const transport = new TransportStub();
  const app = new DiscordBotApp(
    identity,
    new RuntimeStub(),
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
  const app = new DiscordBotApp(
    identity,
    new RuntimeStub(),
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
