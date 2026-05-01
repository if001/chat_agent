import { handleMention } from "./handleMention";
import { AgentRuntime, BotIdentity, ChannelMessage } from "../types";

class RuntimeStub implements AgentRuntime {
  constructor(private readonly content: string) {}
  async respond(): Promise<{ content: string }> {
    return { content: this.content };
  }
}

const identity: BotIdentity = {
  botId: "bot-a",
  systemPrompt: "you are bot a",
};

test("returns null when message is not mention", async () => {
  const message: ChannelMessage = {
    channelId: "c1",
    authorId: "u1",
    content: "hello",
    mentionsBot: false,
  };

  const result = await handleMention(identity, new RuntimeStub("ignored"), message);
  expect(result).toBeNull();
});

test("returns agent response when bot is mentioned", async () => {
  const message: ChannelMessage = {
    channelId: "c1",
    authorId: "u1",
    content: "@bot summarize this",
    mentionsBot: true,
  };

  const result = await handleMention(identity, new RuntimeStub("summary"), message);
  expect(result).toBe("summary");
});
