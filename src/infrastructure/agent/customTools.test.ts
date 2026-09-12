import { createCustomTools } from "./customTools";
import {
  DailyEvent,
} from "../memory/memorySystemClient";
import {
  KnowledgeAccessService,
  KnowledgeAccessAnalysisModel,
  KnowledgeRepository,
  SavedArticle,
  SearchResultItem,
  WebClient,
  WebListItem,
  WebPage,
  createKnowledgeAccessService,
} from "@chat-agent/knowledge-access";
import { AgentRuntimeContext } from "./runtimeContext";

class KnowledgeAccessServiceStub implements KnowledgeAccessService {
  public savedWebKnowledgeInput: { botId: string; threadId?: string; url: string } | null = null;

  async inspectCatalog() {
    return {
      status: "available" as const,
      available: true,
      topics: ["shared agents article"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  async searchSavedKnowledge(_input: {
    query: string;
    limit?: number;
    minScore?: number;
  }): Promise<SearchResultItem[]> {
    void _input;
    return [{ articleId: "a1", score: 0.9, title: "t", summary: "s", tags: ["tag1"], url: "https://example.com" }];
  }

  async getSavedArticle(input: { articleId?: string; url?: string }): Promise<SavedArticle | null> {
    if (input.articleId) {
      return {
        id: input.articleId,
        url: "https://example.com",
        title: "t",
        summary: "s",
        content: "c",
        tags: ["tag1"],
        rawMarkdown: "m",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    }
    if (input.url) {
      return {
        id: "a-by-url",
        url: input.url,
        title: "tu",
        summary: "su",
        content: "cu",
        tags: ["tagu"],
        rawMarkdown: "mu",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    }
    return null;
  }

  async webList(input: { query: string; limit: number }): Promise<WebListItem[]> {
    return [
      {
        rank: 1,
        title: `${input.query}-${input.limit}`,
        url: "https://example.com",
        snippet: "snip",
      },
    ];
  }

  async webPage(input: { url: string }): Promise<WebPage> {
    return { url: input.url, title: "t", markdown: "m" };
  }

  async saveWebKnowledge(input: {
    botId: string;
    threadId?: string;
    url: string;
  }): Promise<{ articleId: string; title: string; summary: string; url: string }> {
    this.savedWebKnowledgeInput = input;
    return {
      articleId: "a1",
      title: "t",
      summary: "generated summary",
      url: input.url,
    };
  }
}

class MemoryStoreStub {
  public notes: Array<{ id: number; note: string; createdAt: Date }> = [];
  public readonly userIds: string[] = [];
  public readonly replacedIds: number[] = [];
  public readonly deletedIds: number[] = [];
  public readonly searchRequests: unknown[] = [];
  public remembered: DailyEvent | null = null;

  async inspectCatalog(input: { botId: string; threadId: string; userId: string }) {
    return {
      status: "available" as const,
      conversationHistory: { status: "available" as const, available: true, topics: [input.threadId] },
      userMemory: { status: "available" as const, available: true, topics: [input.userId] },
      dailyEvents: { status: "empty" as const, available: false, topics: [] },
      policyCards: { status: "available" as const, available: true, topics: [input.botId] },
    };
  }

  async searchMemory(input: {
    botId: string;
    threadId: string;
    userId: string;
    scopes: string[];
    query?: string;
  }) {
    this.searchRequests.push(input);
    return {
      ...(input.scopes.includes("conversation_history")
        ? { conversationHistory: { status: "found" as const, data: [{ turnRecordId: "turn-1", occurredAt: "2026-01-01T00:00:00.000Z", excerpt: "jazz discussion" }] } }
        : {}),
      ...(input.scopes.includes("user_memory")
        ? { userMemory: { status: "found" as const, data: [{ noteId: 1, note: "prefers jazz" }] } }
        : {}),
      ...(input.scopes.includes("policy_cards")
        ? { policyCards: { status: "not_found" as const } }
        : {}),
      ...(input.scopes.includes("daily_events")
        ? {
            dailyEvents: {
              status: "found" as const,
              data: [
                input.query
                  ? {
                      eventId: 1,
                      eventDate: "2026-01-02",
                      summary: "queue のテストを追加した",
                    }
                  : {
                      eventId: 2,
                      eventDate: "2026-01-03",
                      summary: "Dockerfile を追加した",
                    },
              ],
            },
          }
        : {}),
    };
  }

  async rememberUserNote(userId: string, note: string) {
    this.userIds.push(userId);
    const saved = { id: this.notes.length + 1, note, createdAt: new Date("2026-01-01T00:00:00.000Z") };
    this.notes.push(saved);
    return { ok: true, action: "create" as const, note: saved };
  }

  async findUserNotesForManagement() {
    return this.notes.length > 0
      ? this.notes
      : [{ id: 1, note: "prefer concise", createdAt: new Date("2026-01-01T00:00:00.000Z") }];
  }

  async replaceUserNote(_userId: string, noteId: number, note: string) {
    if (noteId !== 1 && !this.notes.some((item) => item.id === noteId)) {
      return { ok: false, error: "not found" };
    }
    this.replacedIds.push(noteId);
    return {
      ok: true,
      action: "replace" as const,
      note: {
        id: noteId,
        note,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    };
  }

  async deleteUserNote(_userId?: string, noteId?: number) {
    if (noteId !== undefined) {
      this.deletedIds.push(noteId);
    }
    return true;
  }

  async rememberDailyEvent(input: {
    userId: string;
    eventDate: string;
    summary: string;
    tags?: string[];
    sourceMessage?: string;
  }): Promise<DailyEvent> {
    this.remembered = {
      id: 1,
      userId: input.userId,
      eventDate: input.eventDate,
      summary: input.summary,
      tags: input.tags ?? [],
      ...(input.sourceMessage ? { sourceMessage: input.sourceMessage } : {}),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    return this.remembered;
  }
}

const createDeps = () => {
  const memoryClient = new MemoryStoreStub();
  return {
    knowledgeAccessService: new KnowledgeAccessServiceStub(),
    memoryClient,
    userMemoryStore: memoryClient,
    botId: "b1",
    runtimeContext: {
      current: () => ({ botId: "b1", userId: "u1", threadId: "c1:u1" }),
    },
  };
};

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
  const service = deps.knowledgeAccessService as KnowledgeAccessServiceStub;
  const tools = createCustomTools(deps);

  const result = await findTool(tools, "save_web_knowledge").invoke({ url: "https://example.com/page" });
  const parsed = JSON.parse(result as string) as { articleId: string; summary: string; url: string };
  expect(parsed.articleId).toBe("a1");
  expect(parsed.summary).toBe("generated summary");
  expect(parsed.url).toBe("https://example.com/page");
  expect(service.savedWebKnowledgeInput?.botId).toBe("b1");
  expect(service.savedWebKnowledgeInput?.url).toBe("https://example.com/page");
});

test("save_web_knowledge fetches the page exactly once", async () => {
  let fetchCount = 0;
  const webClient: WebClient = {
    webList: async () => [],
    webPage: async (url) => {
      fetchCount += 1;
      return { url, title: "single fetch", markdown: "body" };
    },
  };
  const repository: KnowledgeRepository = {
    saveArticle: async (article) => ({
      ...article,
      id: "saved-1",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    getSavedArticleById: async () => null,
    getSavedArticleByUrl: async () => null,
    searchSavedKnowledge: async () => [],
  };
  const analysisModel: KnowledgeAccessAnalysisModel = {
    generateJson: async <T>() =>
      ({ summary: "summary", content: "content", tags: [] }) as T,
  };
  const tools = createCustomTools({
    ...createDeps(),
    knowledgeAccessService: createKnowledgeAccessService({
      repository,
      webClient,
      analysisModel,
    }),
  });

  await findTool(tools, "save_web_knowledge").invoke({
    url: "https://example.com/once",
  });

  expect(fetchCount).toBe(1);
});

test("search_saved_knowledge returns search results", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "search_saved_knowledge").invoke({ query: "langgraph" });
  const parsed = JSON.parse(result as string) as SearchResultItem[];
  expect(parsed[0]?.articleId).toBe("a1");
  expect(parsed[0]?.score).toBeUndefined();
});

test("remember_user_note tool stores note", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  const tools = createCustomTools(deps);

  await findTool(tools, "remember_user_note").invoke({ note: "prefer concise" });
  expect(memoryStore.notes[0]?.note).toBe("prefer concise");
});

test("memory tools use trusted runtime user ID and do not expose userId in schema", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  const runtimeContext = new AgentRuntimeContext();
  const tools = createCustomTools({ ...deps, runtimeContext });
  const memoryToolNames = [
    "remember_user_note",
    "search_user_notes",
    "replace_user_note",
    "delete_user_note",
    "remember_daily_event",
    "search_daily_events",
    "get_daily_events_by_date",
  ];
  for (const name of memoryToolNames) {
    const candidate = findTool(tools, name) as {
      schema?: { shape?: Record<string, unknown> };
    };
    expect(candidate.schema?.shape).not.toHaveProperty("userId");
  }
  const memoryTool = findTool(tools, "remember_user_note") as {
    schema?: { shape?: Record<string, unknown> };
    invoke(input: unknown): Promise<unknown>;
  };

  await runtimeContext.run(
    { botId: "ao", userId: "discord-user-42", threadId: "c1:discord-user-42" },
    () => memoryTool.invoke({ note: "prefer concise answers" }),
  );

  expect(memoryStore.userIds).toEqual(["discord-user-42"]);
});

test("registers one canonical tool for each UserMemory operation", () => {
  const names = createCustomTools(createDeps()).map((candidate) => candidate.name);

  expect(names).toEqual([
    "inspect_context_catalog",
    "search_conversation_memory",
    "search_user_memory",
    "search_response_policies",
    "web_list",
    "web_page",
    "save_web_knowledge",
    "search_saved_knowledge",
    "get_saved_article",
    "remember_user_note",
    "search_user_notes",
    "replace_user_note",
    "delete_user_note",
    "remember_daily_event",
    "search_daily_events",
    "get_daily_events_by_date",
    "enqueue_task",
    "get_queue_status",
  ]);
});

test("get_saved_article returns lightweight payload by default", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_saved_article").invoke({ articleId: "a1" });
  const parsed = JSON.parse(result as string) as { rawMarkdown?: string; summary?: string; content?: string; tags?: string[] };
  expect(parsed.summary).toBe("s");
  expect(parsed.content).toBeUndefined();
  expect(parsed.tags).toEqual(["tag1"]);
  expect(parsed.rawMarkdown).toBeUndefined();
});

test("get_saved_article returns analyzed content only when requested", async () => {
  const tools = createCustomTools(createDeps());
  const target = findTool(tools, "get_saved_article");
  const result = await target.invoke({ articleId: "a1", detail: "content" });
  const parsed = JSON.parse(result as string) as { content?: string; rawMarkdown?: string };
  expect(parsed.content).toBe("c");
  expect(parsed.rawMarkdown).toBeUndefined();
});

test("get_saved_article does not expose a raw payload mode", () => {
  const tool = findTool(createCustomTools(createDeps()), "get_saved_article");
  const detail = (tool.schema as { shape: { detail: { safeParse(value: unknown): unknown } } })
    .shape.detail;

  expect(detail.safeParse("raw")).toMatchObject({ success: false });
});

test("get_saved_article can resolve by url", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_saved_article").invoke({ url: "https://example.com/u" });
  const parsed = JSON.parse(result as string) as { id: string; url: string };
  expect(parsed.id).toBe("a-by-url");
  expect(parsed.url).toBe("https://example.com/u");
});

test("search_user_notes returns IDs for explicit updates", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "search_user_notes").invoke({ query: "concise" });
  const parsed = JSON.parse(result as string) as Array<{ id: number; note: string }>;
  expect(parsed[0]).toMatchObject({ id: 1, note: "prefer concise" });
});

test("replace and delete user note tools operate on an explicit searched ID", async () => {
  const deps = createDeps();
  const tools = createCustomTools(deps);

  const replaced = JSON.parse(
    (await findTool(tools, "replace_user_note").invoke({
      noteId: 1,
      note: "prefer detailed answers",
    })) as string,
  ) as { ok: boolean; note: { id: number; note: string } };
  const deleted = JSON.parse(
    (await findTool(tools, "delete_user_note").invoke({ noteId: 1 })) as string,
  ) as { ok: boolean };

  expect(replaced).toMatchObject({
    ok: true,
    note: { id: 1, note: "prefer detailed answers" },
  });
  expect(deleted.ok).toBe(true);
});

test("explicit replacement returns the memory-system not-found result", async () => {
  const deps = createDeps();
  const tools = createCustomTools(deps);

  const result = JSON.parse(
    (await findTool(tools, "replace_user_note").invoke({
      noteId: 999,
      note: "詳細な回答が好き",
    })) as string,
  ) as { ok: boolean };

  expect(result.ok).toBe(false);
});

test("remember_daily_event stores concise daily record", async () => {
  const deps = createDeps();
  const dailyEvents = deps.memoryClient as MemoryStoreStub;
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
  const parsed = JSON.parse(result as string) as { status: string; data: DailyEvent[] };
  expect(parsed.status).toBe("found");
  expect(parsed.data[0]?.summary).toContain("queue");
});

test("memory discovery tools inject trusted runtime scope and expose no identity arguments", async () => {
  const deps = createDeps();
  const runtime = new AgentRuntimeContext();
  const tools = createCustomTools({ ...deps, runtimeContext: runtime });
  for (const name of [
    "inspect_context_catalog",
    "search_conversation_memory",
    "search_user_memory",
    "search_daily_events",
    "search_response_policies",
  ]) {
    const candidate = findTool(tools, name) as {
      schema?: { shape?: Record<string, unknown> };
      invoke(input: unknown): Promise<unknown>;
    };
    expect(candidate.schema?.shape).not.toHaveProperty("botId");
    expect(candidate.schema?.shape).not.toHaveProperty("threadId");
    expect(candidate.schema?.shape).not.toHaveProperty("userId");
  }

  const catalog = await runtime.run(
    { botId: "aka", threadId: "discord-thread", userId: "user-42" },
    () => findTool(tools, "inspect_context_catalog").invoke({ query: "music" }),
  );
  const parsedCatalog = JSON.parse(catalog as string);
  expect(parsedCatalog.memory.conversationHistory.topics).toEqual(["discord-thread"]);
  expect(parsedCatalog.memory.userMemory.topics).toEqual(["user-42"]);

  await runtime.run(
    { botId: "aka", threadId: "discord-thread", userId: "user-42" },
    () => findTool(tools, "search_user_memory").invoke({ query: "music" }),
  );
  expect(deps.userMemoryStore.searchRequests[0]).toMatchObject({
    botId: "aka",
    threadId: "discord-thread",
    userId: "user-42",
    scopes: ["user_memory"],
  });
});

test("memory search preserves not_found and converts repeated backend failure to unavailable", async () => {
  const deps = createDeps();
  const tools = createCustomTools(deps);
  const notFound = JSON.parse(
    (await findTool(tools, "search_response_policies").invoke({ query: "hello" })) as string,
  );
  expect(notFound).toEqual({ status: "not_found" });

  let calls = 0;
  deps.userMemoryStore.searchMemory = async () => {
    calls += 1;
    throw new Error("503 memory backend unavailable");
  };
  const unavailable = JSON.parse(
    (await findTool(tools, "search_user_memory").invoke({ query: "music" })) as string,
  );
  expect(unavailable).toEqual({
    status: "unavailable",
    reason: "Memory search failed",
  });
  expect(calls).toBe(2);
});

test("get_daily_events_by_date returns nearby records", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "get_daily_events_by_date").invoke({ date: "2026-01-03", windowDays: 1 });
  const parsed = JSON.parse(result as string) as {
    status: string;
    data: Array<{ summary: string }>;
  };
  expect(parsed.status).toBe("found");
  expect(parsed.data[0]?.summary).toContain("Dockerfile");
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
