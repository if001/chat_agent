import { createCustomTools } from "./customTools";
import {
  DailyEvent,
  DailyEventRepository,
  KnowledgeRepository,
  SavedArticle,
  SearchResultItem,
  UserMemoryStore,
  WebClient,
  WebListItem,
  WebPage,
} from "../../core/types";

class KnowledgeRepoStub implements KnowledgeRepository {
  public savedArticleInput: Omit<SavedArticle, "id" | "createdAt"> | null = null;

  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    this.savedArticleInput = article;
    return { ...article, id: "a1", createdAt: new Date("2026-01-01T00:00:00.000Z") };
  }

  async getSavedArticleById(articleId: string): Promise<SavedArticle | null> {
    return {
      id: articleId,
      url: "https://example.com",
      title: "t",
      summary: "s",
      content: "c",
      tags: ["tag1"],
      rawMarkdown: "m",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }

  async getSavedArticleByUrl(url: string): Promise<SavedArticle | null> {
    return {
      id: "a-by-url",
      url,
      title: "tu",
      summary: "su",
      content: "cu",
      tags: ["tagu"],
      rawMarkdown: "mu",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }

  async searchSavedKnowledge(_query: string): Promise<SearchResultItem[]> {
    return [{ articleId: "a1", score: 0.9, title: "t", summary: "s", tags: ["tag1"], url: "https://example.com" }];
  }
}

class WebClientStub implements WebClient {
  async webList(query: string, k: number): Promise<WebListItem[]> {
    return [{ rank: 1, title: `${query}-${k}`, url: "https://example.com", snippet: "snip" }];
  }

  async webPage(url: string): Promise<WebPage> {
    return { url, title: "t", markdown: "m" };
  }
}

class MemoryStoreStub implements UserMemoryStore {
  public notes: string[] = [];

  async rememberUserNote(_botId: string, _userId: string, note: string): Promise<void> {
    this.notes.push(note);
  }

  async readMemoryFile(path: string): Promise<string> {
    return `file:${path}`;
  }

  async listUserNotes(): Promise<Array<{ note: string; createdAt: Date }>> {
    return [{ note: "prefer concise", createdAt: new Date("2026-01-01T00:00:00.000Z") }];
  }
}

class DailyEventRepoStub implements DailyEventRepository {
  public remembered: DailyEvent | null = null;

  async rememberDailyEvent(input: {
    botId: string;
    userId: string;
    eventDate: string;
    summary: string;
    tags?: string[];
    sourceMessage?: string;
  }): Promise<DailyEvent> {
    this.remembered = {
      id: 1,
      botId: input.botId,
      userId: input.userId,
      eventDate: input.eventDate,
      summary: input.summary,
      tags: input.tags ?? [],
      ...(input.sourceMessage ? { sourceMessage: input.sourceMessage } : {}),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    return this.remembered;
  }

  async searchDailyEvents(): Promise<DailyEvent[]> {
    return [
      {
        id: 1,
        botId: "b1",
        userId: "u1",
        eventDate: "2026-01-02",
        summary: "queue のテストを追加した",
        tags: ["queue", "test"],
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ];
  }

  async getDailyEventsByDate(): Promise<DailyEvent[]> {
    return [
      {
        id: 2,
        botId: "b1",
        userId: "u1",
        eventDate: "2026-01-03",
        summary: "Dockerfile を追加した",
        tags: ["docker"],
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ];
  }
}

const createDeps = () => ({
  knowledgeRepository: new KnowledgeRepoStub(),
  webClient: new WebClientStub(),
  userMemoryStore: new MemoryStoreStub(),
  dailyEventRepository: new DailyEventRepoStub(),
  defaultUserId: "u1",
  botId: "b1",
});

const findTool = (tools: Array<{ name: string; invoke(input: unknown): Promise<unknown> }>, name: string) => {
  const target = tools.find((tool) => tool.name === name);
  if (!target) {
    throw new Error(`${name} tool not found`);
  }
  return target;
};

test("web_list returns list payload", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "web_list").invoke({ query: "langgraph", k: 3 });
  const parsed = JSON.parse(result as string) as { query: string; k: number; results: WebListItem[] };
  expect(parsed.query).toBe("langgraph");
  expect(parsed.k).toBe(3);
  expect(parsed.results[0]?.title).toBe("langgraph-3");
});

test("web_page returns page payload", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "web_page").invoke({ url: "https://example.com/page" });
  const parsed = JSON.parse(result as string) as WebPage;
  expect(parsed.url).toBe("https://example.com/page");
  expect(parsed.markdown).toBe("m");
});

test("save_web_knowledge fetches and stores article", async () => {
  const deps = createDeps();
  const repo = deps.knowledgeRepository as KnowledgeRepoStub;
  const tools = createCustomTools({
    ...deps,
    analyzeArticle: async () => ({
      summary: "generated summary",
      content: "generated content",
      tags: ["ai", "agents"],
    }),
  });

  const result = await findTool(tools, "save_web_knowledge").invoke({ url: "https://example.com/page" });
  const parsed = JSON.parse(result as string) as { articleId: string; summary: string; tags: string[] };
  expect(parsed.articleId).toBe("a1");
  expect(parsed.summary).toBe("generated summary");
  expect(parsed.tags).toEqual(["ai", "agents"]);
  expect(repo.savedArticleInput?.url).toBe("https://example.com/page");
  expect(repo.savedArticleInput?.content).toBe("generated content");
  expect(repo.savedArticleInput?.tags).toEqual(["ai", "agents"]);
});

test("search_saved_knowledge returns search results", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "search_saved_knowledge").invoke({ query: "langgraph" });
  const parsed = JSON.parse(result as string) as SearchResultItem[];
  expect(parsed[0]?.articleId).toBe("a1");
  expect(parsed[0]?.score).toBe(0.9);
});

test("remember_user_note tool stores note", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  const tools = createCustomTools(deps);

  await findTool(tools, "remember_user_note").invoke({ note: "prefer concise" });
  expect(memoryStore.notes[0]).toBe("prefer concise");
});

test("read_memory_file returns file content", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "read_memory_file").invoke({ path: "/memories/research-notes.md" });
  const parsed = JSON.parse(result as string) as { path: string; content: string };
  expect(parsed.path).toBe("/memories/research-notes.md");
  expect(parsed.content).toContain("file:/memories/research-notes.md");
});

test("get_saved_article returns lightweight payload by default", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_saved_article").invoke({ articleId: "a1" });
  const parsed = JSON.parse(result as string) as { rawMarkdown?: string; summary?: string; content?: string; tags?: string[] };
  expect(parsed.summary).toBe("s");
  expect(parsed.content).toBe("c");
  expect(parsed.tags).toEqual(["tag1"]);
  expect(parsed.rawMarkdown).toBeUndefined();
});

test("get_saved_article can resolve by url", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_saved_article").invoke({ url: "https://example.com/u" });
  const parsed = JSON.parse(result as string) as { id: string; url: string };
  expect(parsed.id).toBe("a-by-url");
  expect(parsed.url).toBe("https://example.com/u");
});

test("get_user_notes returns remembered notes", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_user_notes").invoke({});
  const parsed = JSON.parse(result as string) as Array<{ note: string }>;
  expect(parsed[0]?.note).toBe("prefer concise");
});

test("remember_daily_event stores concise daily record", async () => {
  const deps = createDeps();
  const dailyEvents = deps.dailyEventRepository as DailyEventRepoStub;
  const tools = createCustomTools(deps);

  const result = await findTool(tools, "remember_daily_event").invoke({
    eventDate: "20260506",
    summary: "queue のテストを追加した",
    tags: ["queue", "test"],
  });
  const parsed = JSON.parse(result as string) as DailyEvent;
  expect(parsed.eventDate).toBe("20260506");
  expect(parsed.summary).toBe("queue のテストを追加した");
  expect(dailyEvents.remembered?.summary).toBe("queue のテストを追加した");
  expect(dailyEvents.remembered?.tags).toEqual(["queue", "test"]);
});

test("search_daily_events returns matching records", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "search_daily_events").invoke({ query: "queue" });
  const parsed = JSON.parse(result as string) as DailyEvent[];
  expect(parsed[0]?.summary).toContain("queue");
});

test("get_daily_events_by_date returns nearby records", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_daily_events_by_date").invoke({ date: "2026-01-03", windowDays: 1 });
  const parsed = JSON.parse(result as string) as DailyEvent[];
  expect(parsed[0]?.summary).toContain("Dockerfile");
});

test("enqueue_task returns queue created message", async () => {
  const tools = createCustomTools({
    ...createDeps(),
    enqueueTask: async ({ text }) => ({
      id: `t_${text.length}`,
      dueAt: new Date("2026-01-01T01:00:00.000Z").toISOString(),
      type: "scheduled_once",
    }),
  });

  const result = await findTool(tools, "enqueue_task").invoke({
    text: "follow up in 1 hour",
    delayMinutes: 60,
  });
  const parsed = JSON.parse(result as string) as { ok: boolean; message: string };
  expect(parsed.ok).toBe(true);
  expect(parsed.message).toContain("queueを作成しました");
});

test("get_queue_status returns status payload", async () => {
  const tools = createCustomTools({
    ...createDeps(),
    getQueueStatus: async ({ limit } = {}) => ({ counts: { total: 3 }, next: new Array(limit ?? 5).fill({}) }),
  });

  const result = await findTool(tools, "get_queue_status").invoke({ limit: 2 });
  const parsed = JSON.parse(result as string) as { counts: { total: number }; next: unknown[] };
  expect(parsed.counts.total).toBe(3);
  expect(parsed.next.length).toBe(2);
});
