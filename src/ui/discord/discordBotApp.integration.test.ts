import { DiscordJsTransport } from "../../infrastructure/discord/discordJsTransport";
import { DiscordBotApp } from "./discordBotApp";
import { AgentRuntime, BotIdentity } from "../../core/types";

interface HandlerMap {
  messageCreate?: (message: {
    content: string;
    author: { id: string; bot: boolean };
    channel: {
      id: string;
      send(content: string): Promise<void>;
      sendTyping(): Promise<void>;
    };
    mentions: { has(userId: string): boolean };
  }) => Promise<void> | void;
}

class FakeClient {
  public user: { id: string } | null = { id: "bot-b" };
  public readonly handlers: HandlerMap = {};

  on(event: "messageCreate", handler: HandlerMap["messageCreate"]): void {
    this.handlers[event] = handler;
  }
}

class RuntimeStub implements AgentRuntime {
  public readonly requests: string[] = [];

  async respond(request: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ content: string }> {
    const content = request.messages.at(-1)?.content ?? "";
    this.requests.push(content);
    return { content: `reply:${content}` };
  }
}

const identity: BotIdentity = {
  botId: "ao",
  systemPrompt: "You are helpful",
};

test("botB replies when allowlisted botA mentions botB", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
  try {
    const client = new FakeClient();
    const transport = new DiscordJsTransport(client, ["bot-a"]);
    const runtime = new RuntimeStub();
    const app = new DiscordBotApp(
      identity,
      runtime,
      transport,
      "mention-channel",
      "bot-b",
    );
    app.start();

    const sent: string[] = [];
    let typingCount = 0;
    const handler = client.handlers.messageCreate;
    if (!handler) {
      throw new Error("messageCreate handler not found");
    }

    await handler({
      content: "<@bot-b>\nhello from botA",
      author: { id: "bot-a", bot: true },
      channel: {
        id: "mention-channel",
        send: async (content: string) => {
          sent.push(content);
        },
        sendTyping: async () => {
          typingCount += 1;
        },
      },
      mentions: { has: (userId: string) => userId === "bot-b" },
    });

    expect(typingCount).toBe(1);
    expect(runtime.requests).toEqual([
      "Current time: 2026-05-13T00:00:00.000Z\n\nUser message:\nhello from botA",
    ]);
    expect(sent).toEqual([
      "reply:Current time: 2026-05-13T00:00:00.000Z\n\nUser message:\nhello from botA",
    ]);
  } finally {
    jest.useRealTimers();
  }
});
