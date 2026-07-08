import { DiscordIngestApp } from "./discordIngestApp";
import { DiscordTransport } from "./discordBotApp";
import { BotIdentity, ChannelMessage } from "../../core/types";
import { KnowledgeAccessService, SavedArticle, SearchResultItem, WebListItem, WebPage } from "@chat-agent/knowledge-access";

class KnowledgeAccessServiceStub implements KnowledgeAccessService {
  constructor(private readonly failUrls: Set<string> = new Set()) {}

  async searchSavedKnowledge(_input: {
    query: string;
    limit?: number;
    minScore?: number;
  }): Promise<SearchResultItem[]> {
    return [];
  }

  async getSavedArticle(_input: {
    articleId?: string;
    url?: string;
  }): Promise<SavedArticle | null> {
    return null;
  }

  async webList(_input: {
    query: string;
    limit: number;
  }): Promise<WebListItem[]> {
    return [];
  }

  async webPage(input: { url: string }): Promise<WebPage> {
    if (this.failUrls.has(input.url)) {
      throw new Error(`failed to fetch ${input.url}`);
    }
    return {
      url: input.url,
      title: "Readme",
      markdown: "Long markdown",
    };
  }

  async saveWebKnowledge(input: {
    botId: string;
    threadId?: string;
    url: string;
  }): Promise<{ articleId: string; title: string; summary: string; url: string }> {
    const page = await this.webPage({ url: input.url });
    return {
      articleId: "article_1",
      title: page.title,
      summary: "summary text",
      url: page.url,
    };
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
  botId: "bot-ingest",
  systemPrompt: "You summarize articles",
};

test("ingests url and posts summary in ingest channel", async () => {
  const transport = new TransportStub();
  const app = new DiscordIngestApp(
    identity,
    new KnowledgeAccessServiceStub(),
    transport,
    "ingest-channel",
  );

  app.start();
  await transport.emit({
    channelId: "ingest-channel",
    authorId: "user-1",
    content: "https://example.com/post",
    mentionsBot: false,
  });

  expect(transport.typing[0]).toBe("ingest-channel");
  expect(transport.sent[0]?.content).toContain("保存しました: Readme");
  expect(transport.sent[0]?.content).toContain("summary text");
});

test("ignores messages outside ingest channel", async () => {
  const transport = new TransportStub();
  const app = new DiscordIngestApp(
    identity,
    new KnowledgeAccessServiceStub(),
    transport,
    "ingest-channel",
  );

  app.start();
  await transport.emit({
    channelId: "other-channel",
    authorId: "user-1",
    content: "https://example.com/post",
    mentionsBot: false,
  });

  expect(transport.typing).toHaveLength(0);
  expect(transport.sent).toHaveLength(0);
});

test("reports ingest errors and continues processing", async () => {
  const transport = new TransportStub();
  const logs: string[] = [];
  const app = new DiscordIngestApp(
    identity,
    new KnowledgeAccessServiceStub(new Set(["https://example.com/fail"])),
    transport,
    "ingest-channel",
    (message) => {
      logs.push(message);
    },
  );

  app.start();
  await transport.emit({
    channelId: "ingest-channel",
    authorId: "user-1",
    content: "https://example.com/fail https://example.com/ok",
    mentionsBot: false,
  });

  expect(logs[0]).toContain("[ingest-error]");
  expect(transport.sent[0]?.content).toContain("エラーが発生しました");
  expect(transport.sent[1]?.content).toContain("保存しました: Readme");
});
