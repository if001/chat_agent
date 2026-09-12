import { KnowledgeAccessService } from "@chat-agent/knowledge-access";
import {
  DailyEvent,
  MemoryUserNote,
} from "../infrastructure/memory/memorySystemClient";
import { createCustomTools } from "../infrastructure/agent/customTools";
import { DeepAgentRuntime } from "../infrastructure/agent/deepAgentRuntime";
import { RequestContextBuilder } from "../infrastructure/agent/requestContextBuilder";
import { loadSystemPromptByBotId } from "../config/systemPromptLoader";
import { longConversationFixture } from "./fixtures/longConversation";
import {
  AgentRequest,
  AgentRuntime,
  ChannelMessage,
} from "../core/types";
import {
  DiscordBotApp,
  DiscordTransport,
} from "../ui/discord/discordBotApp";

class FixtureUserMemoryStore {
  private notes: MemoryUserNote[] = [
    {
      id: 1,
      note: "簡潔な回答を好む",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    {
      id: 2,
      note: "ジャズをよく聴く",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    },
  ];

  async rememberUserNote(_userId: string, note: string) {
    const saved = { id: this.notes.length + 1, note, createdAt: new Date() };
    this.notes.push(saved);
    return { ok: true, action: "create" as const, note: saved };
  }

  async findUserNotesForManagement(
    _userId: string,
    query: string,
    limit: number,
  ): Promise<MemoryUserNote[]> {
    return this.notes
      .filter((item) => item.note.includes(query))
      .slice(0, limit);
  }

  async replaceUserNote(
    _userId: string,
    noteId: number,
    note: string,
  ) {
    const index = this.notes.findIndex((item) => item.id === noteId);
    if (index < 0) {
      return { ok: false };
    }
    const saved = { ...this.notes[index]!, note };
    this.notes[index] = saved;
    return { ok: true, action: "replace" as const, note: saved };
  }

  async deleteUserNote(_userId: string, noteId: number): Promise<boolean> {
    const previousLength = this.notes.length;
    this.notes = this.notes.filter((item) => item.id !== noteId);
    return this.notes.length < previousLength;
  }

  async rememberDailyEvent(): Promise<DailyEvent> {
    throw new Error("not used by this fixture");
  }

  async inspectCatalog() {
    return {
      status: "available" as const,
      conversationHistory: {
        status: "available" as const,
        available: true,
        topics: ["以前の音楽の会話"],
      },
      userMemory: {
        status: "available" as const,
        available: true,
        topics: ["音楽の好み"],
      },
      dailyEvents: {
        status: "available" as const,
        available: true,
        topics: ["release"],
      },
      policyCards: {
        status: "empty" as const,
        available: false,
        topics: [],
      },
    };
  }

  async searchMemory(input: { botId: string; scopes: string[] }) {
    return {
      ...(input.scopes.includes("conversation_history")
        ? {
            conversationHistory: {
              status: "found" as const,
              data: [
                {
                  turnRecordId: "turn-old-music",
                  occurredAt: "2026-07-01T09:00:00.000Z",
                  excerpt: "ユーザーはジャズをよく聴くと話した",
                },
              ],
            },
          }
        : {}),
      ...(input.scopes.includes("user_memory")
        ? {
            userMemory: {
              status: "found" as const,
              data: [{ noteId: 2, note: "ジャズをよく聴く" }],
            },
          }
        : {}),
      ...(input.scopes.includes("policy_cards")
        ? {
            policyCards: {
              status: "found" as const,
              data: [
                {
                  policyCardId: `${input.botId}-policy`,
                  appliesWhen: `${input.botId} handles this thread`,
                  recommendedBehavior: `${input.botId} specific response`,
                },
              ],
            },
          }
        : {}),
      ...(input.scopes.includes("daily_events")
        ? {
            dailyEvents: {
              status: "found" as const,
              data: [
                {
                  eventId: 1,
                  eventDate: "2026-08-30",
                  summary: "release 1.0を公開した",
                },
              ],
            },
          }
        : {}),
    };
  }
}

const knowledgeAccessService = {
  inspectCatalog: async () => ({
    status: "available" as const,
    available: true,
    topics: ["ジャズ即興入門", "music"],
  }),
  searchSavedKnowledge: async () => [
    {
      articleId: "article-jazz",
      score: 0.91,
      title: "ジャズ即興入門",
      summary: "コード進行を聴く練習方法",
      tags: ["music"],
      url: "https://example.com/jazz",
    },
  ],
  getSavedArticle: async () => ({
    id: "article-jazz",
    url: "https://example.com/jazz",
    title: "ジャズ即興入門",
    summary: "コード進行を聴く練習方法",
    content: "まずII-V-Iを歌って確認する。",
    tags: ["music"],
    rawMarkdown: "# secret raw source payload",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  }),
  webList: async () => [],
  webPage: async ({ url }: { url: string }) => ({
    url,
    title: "fixture",
    markdown: "fixture",
  }),
  saveWebKnowledge: async ({ url }: { url: string }) => ({
    articleId: "fixture-1",
    title: "fixture",
    summary: "fixture",
    url,
  }),
} as KnowledgeAccessService;

const findTool = (
  tools: Array<{ name: string; invoke(input: unknown): Promise<unknown> }>,
  name: string,
) => {
  const selected = tools.find((candidate) => candidate.name === name);
  if (!selected) {
    throw new Error(`missing fixture tool: ${name}`);
  }
  return selected;
};

class E2eDiscordTransport implements DiscordTransport {
  private handler: ((message: ChannelMessage) => Promise<void>) | null = null;
  readonly sent: string[] = [];

  onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendMessage(_channelId: string, content: string): Promise<void> {
    this.sent.push(content);
  }

  async sendTyping(): Promise<void> {}

  async emit(message: ChannelMessage): Promise<void> {
    if (!this.handler) throw new Error("Discord handler is not registered");
    await this.handler(message);
  }
}

class CatalogDrivenRuntime implements AgentRuntime {
  readonly requests: AgentRequest[] = [];

  constructor(
    private readonly tools: Array<{
      name: string;
      invoke(input: unknown): Promise<unknown>;
    }>,
  ) {}

  async respond(request: AgentRequest) {
    this.requests.push(request);
    const catalog = JSON.parse(
      (await findTool(this.tools, "inspect_context_catalog").invoke({
        query: "昔話した音楽",
      })) as string,
    ) as { memory: { conversationHistory: { available: boolean } } };
    if (!catalog.memory.conversationHistory.available) {
      return { content: "過去の会話は見つかりませんでした。" };
    }
    const [conversation, articles] = await Promise.all([
      findTool(this.tools, "search_conversation_memory").invoke({
        query: "昔話した音楽",
      }),
      findTool(this.tools, "search_saved_knowledge").invoke({
        query: "ジャズ",
      }),
    ]);
    const history = JSON.parse(conversation as string) as {
      data: Array<{ excerpt: string }>;
    };
    const knowledge = JSON.parse(articles as string) as Array<{
      title: string;
    }>;
    return {
      content: `${history.data[0]?.excerpt}。保存記事「${knowledge[0]?.title}」もあります。`,
    };
  }
}

test("fixed long conversation uses checkpoint context without eager memory injection", async () => {
  const userMemoryStore = new FixtureUserMemoryStore();
  const tools = createCustomTools({
    knowledgeAccessService,
    memoryClient: userMemoryStore,
    botId: "ao",
    runtimeContext: {
      current: () => ({
        botId: "ao",
        userId: "user-1",
        threadId: "shared-thread",
      }),
    },
  });

  const searched = JSON.parse(
    (await findTool(tools, "search_user_notes").invoke({ query: "簡潔" })) as string,
  ) as MemoryUserNote[];
  expect(searched).toHaveLength(1);
  await findTool(tools, "replace_user_note").invoke({
    noteId: searched[0]?.id,
    note: "詳しい回答を好む",
  });

  const catalog = JSON.parse(
    (await findTool(tools, "inspect_context_catalog").invoke({
      query: "前に話した音楽",
    })) as string,
  ) as { memory: { conversationHistory: { topics: string[] } }; knowledge: { topics: string[] } };
  expect(catalog.memory.conversationHistory.topics).toContain("以前の音楽の会話");
  expect(catalog.knowledge.topics).toContain("ジャズ即興入門");
  expect(JSON.stringify(catalog)).not.toContain("secret raw source payload");

  const oldConversation = JSON.parse(
    (await findTool(tools, "search_conversation_memory").invoke({
      query: "昔話した音楽",
    })) as string,
  ) as { status: string; data: Array<{ excerpt: string }> };
  expect(oldConversation.data[0]?.excerpt).toContain("ジャズ");

  const paraphrasedPreference = JSON.parse(
    (await findTool(tools, "search_user_memory").invoke({
      query: "どんな音楽が好き？",
    })) as string,
  ) as { status: string; data: Array<{ note: string }> };
  expect(paraphrasedPreference.data[0]?.note).toBe("ジャズをよく聴く");

  const datedEvents = JSON.parse(
    (await findTool(tools, "get_daily_events_by_date").invoke({
      date: "2026-08-30",
      windowDays: 0,
    })) as string,
  ) as { status: string; data: Array<{ summary: string }> };
  expect(
    datedEvents.data.some((event) => event.summary.includes("release 1.0")),
  ).toBe(true);

  const articles = JSON.parse(
    (await findTool(tools, "search_saved_knowledge").invoke({ query: "ジャズ" })) as string,
  ) as Array<{ articleId: string; score?: number; rawMarkdown?: string }>;
  expect(articles).toEqual([
    expect.objectContaining({ articleId: "article-jazz" }),
  ]);
  expect(articles[0]?.score).toBeUndefined();
  expect(articles[0]?.rawMarkdown).toBeUndefined();
  const article = JSON.parse(
    (await findTool(tools, "get_saved_article").invoke({
      articleId: "article-jazz",
      detail: "content",
    })) as string,
  ) as { content: string; rawMarkdown?: string };
  expect(article.content).toContain("II-V-I");
  expect(article.rawMarkdown).toBeUndefined();

  const akaTools = createCustomTools({
    knowledgeAccessService,
    memoryClient: userMemoryStore,
    botId: "aka",
    runtimeContext: {
      current: () => ({
        botId: "aka",
        userId: "user-1",
        threadId: "shared-thread",
      }),
    },
  });
  const [aoSharedMemory, akaSharedMemory, aoPolicy, akaPolicy] = await Promise.all([
    findTool(tools, "search_user_memory").invoke({ query: "音楽" }),
    findTool(akaTools, "search_user_memory").invoke({ query: "音楽" }),
    findTool(tools, "search_response_policies").invoke({ query: "reply" }),
    findTool(akaTools, "search_response_policies").invoke({ query: "reply" }),
  ]);
  expect(aoSharedMemory).toBe(akaSharedMemory);
  expect(aoPolicy).toContain("ao-policy");
  expect(akaPolicy).toContain("aka-policy");
  expect(aoPolicy).not.toContain("aka-policy");
  const [aoEvents, akaEvents, aoArticles, akaArticles] = await Promise.all([
    findTool(tools, "get_daily_events_by_date").invoke({ date: "2026-08-30" }),
    findTool(akaTools, "get_daily_events_by_date").invoke({
      date: "2026-08-30",
    }),
    findTool(tools, "search_saved_knowledge").invoke({ query: "ジャズ" }),
    findTool(akaTools, "search_saved_knowledge").invoke({ query: "ジャズ" }),
  ]);
  expect(aoEvents).toBe(akaEvents);
  expect(aoArticles).toBe(akaArticles);

  const policyInputs: string[] = [];
  const builder = new RequestContextBuilder(
    () => new Date("2026-09-01T09:00:00.000Z"),
  );
  const build = (botId: string) =>
    builder.build({
      botId,
      userId: "user-1",
      threadId: "shared-thread",
      currentContext: "元のCIの話に戻って続きを進めよう",
      kind: "human",
    });
  const [aoContext, akaContext] = await Promise.all([build("ao"), build("aka")]);

  expect(aoContext).not.toContain("詳しい回答を好む");
  expect(akaContext).not.toContain("詳しい回答を好む");
  expect(aoContext).not.toContain("簡潔な回答を好む");
  expect(aoContext).not.toContain("CIの原因調査を再開した");
  expect(aoContext).not.toContain("release 1.0を公開した");
  expect(aoContext).not.toContain("ao-only policy");
  expect(aoContext).not.toContain("Conversation Focus");
  expect(aoContext).not.toContain("aka-only policy");
  expect(akaContext).not.toContain("aka-only policy");
  expect(akaContext).not.toContain("ao-only policy");
  expect(policyInputs).toEqual([]);

  const proactive = longConversationFixture.find(
    (record) => record.kind === "proactive",
  );
  const reaction = longConversationFixture.find(
    (record) =>
      record.kind === "human" &&
      record.sourceInteractionId === proactive?.sourceInteractionId,
  );
  expect(proactive?.sourceInteractionId).toBe(
    "pomdp_123e4567-e89b-42d3-a456-426614174000",
  );
  expect(reaction?.sourceInteractionId).toBe(proactive?.sourceInteractionId);
  expect(longConversationFixture.some((record) => record.kind === "delegation")).toBe(
    true,
  );

  const aoPrompt = loadSystemPromptByBotId("ao", "fallback");
  const akaPrompt = loadSystemPromptByBotId("aka", "fallback");
  expect(aoPrompt).toContain("アオ");
  expect(aoPrompt).toContain("アカ");
  expect(akaPrompt).toContain("アカ");
  expect(akaPrompt).toContain("アオ");
  expect(aoPrompt).not.toBe(akaPrompt);

  const createdPrompts: string[] = [];
  const checkpointThreads: string[] = [];
  const invocationContexts: string[] = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    ({ systemPrompt }) => {
      createdPrompts.push(systemPrompt);
      return {
        invoke: async (input, config) => {
          checkpointThreads.push(config.configurable.thread_id);
          invocationContexts.push(input.messages[0]?.content ?? "");
          return { messages: [{ role: "assistant", content: "fixture reply" }] };
        },
      };
    },
    () => undefined,
    () => undefined,
  );
  await runtime.respond({
    botId: "ao",
    userId: "user-1",
    systemPrompt: aoPrompt,
    requestContext: aoContext,
    threadId: "shared-thread",
    messages: [{ role: "user", content: "アカに調査を依頼して" }],
  });
  await runtime.respond({
    botId: "aka",
    userId: "user-1",
    systemPrompt: akaPrompt,
    requestContext: akaContext,
    threadId: "shared-thread",
    messages: [{ role: "user", content: "アオからの調査依頼" }],
  });

  expect(createdPrompts).toEqual([aoPrompt, akaPrompt]);
  expect(checkpointThreads).toEqual([
    "ao:shared-thread",
    "aka:shared-thread",
  ]);
  expect(invocationContexts[0]).not.toContain("ao-only policy");
  expect(invocationContexts[0]).not.toContain("aka-only policy");
  expect(invocationContexts[1]).not.toContain("aka-only policy");
  expect(invocationContexts[1]).not.toContain("ao-only policy");
});

test("Discord response discovers the catalog before retrieving old conversation and knowledge", async () => {
  const memory = new FixtureUserMemoryStore();
  const tools = createCustomTools({
    knowledgeAccessService,
    memoryClient: memory,
    botId: "ao",
    runtimeContext: {
      current: () => ({
        botId: "ao",
        userId: "user-1",
        threadId: "channel-1:user-1",
      }),
    },
  });
  const runtime = new CatalogDrivenRuntime(tools);
  const transport = new E2eDiscordTransport();
  const app = new DiscordBotApp(
    { botId: "ao", systemPrompt: "fixture" },
    runtime,
    transport,
    "channel-1",
  );
  app.start();

  await transport.emit({
    channelId: "channel-1",
    authorId: "user-1",
    content: "前に話した音楽と関連する保存記事を教えて",
    mentionsBot: true,
  });

  expect(transport.sent[0]).toContain("ジャズをよく聴く");
  expect(transport.sent[0]).toContain("ジャズ即興入門");
  expect(runtime.requests[0]?.requestContext).toBeUndefined();
  expect(JSON.stringify(runtime.requests)).not.toContain("secret raw source payload");
});
