import { createCustomTools } from "./customTools";
import {
  DailyEvent,
  DailyEventRepository,
  UserMemoryStore,
} from "../../core/types";
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
import {
  UserMemoryWriteDecision,
  UserMemoryWritePlanner,
} from "../memory/userMemoryWritePlanner";

class KnowledgeAccessServiceStub implements KnowledgeAccessService {
  public savedWebKnowledgeInput: { botId: string; threadId?: string; url: string } | null = null;

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

class MemoryStoreStub implements UserMemoryStore {
  public notes: Array<{ id: number; note: string; createdAt: Date }> = [];
  public readonly userIds: string[] = [];
  public readonly replacedIds: number[] = [];
  public readonly deletedIds: number[] = [];

  async rememberUserNote(userId: string, note: string) {
    this.userIds.push(userId);
    const saved = { id: this.notes.length + 1, note, createdAt: new Date("2026-01-01T00:00:00.000Z") };
    this.notes.push(saved);
    return saved;
  }

  async searchUserNotes() {
    return this.notes.length > 0
      ? this.notes
      : [{ id: 1, note: "prefer concise", createdAt: new Date("2026-01-01T00:00:00.000Z") }];
  }

  async replaceUserNote(_userId: string, noteId: number, note: string) {
    this.replacedIds.push(noteId);
    return { id: noteId, note, createdAt: new Date("2026-01-01T00:00:00.000Z") };
  }

  async deleteUserNote(_userId?: string, noteId?: number) {
    if (noteId !== undefined) {
      this.deletedIds.push(noteId);
    }
    return true;
  }
}

class MemoryWritePlannerStub implements UserMemoryWritePlanner {
  public readonly calls: Array<{
    proposedNote: string;
    candidateIds: number[];
    explicitTargetNoteId?: number;
  }> = [];

  constructor(
    private readonly decideWith?: (
      input: Parameters<UserMemoryWritePlanner["decide"]>[0],
    ) => UserMemoryWriteDecision | null,
  ) {}

  async decide(input: Parameters<UserMemoryWritePlanner["decide"]>[0]) {
    this.calls.push({
      proposedNote: input.proposedNote,
      candidateIds: input.candidates.map(({ id }) => id),
      ...(input.explicitTargetNoteId !== undefined
        ? { explicitTargetNoteId: input.explicitTargetNoteId }
        : {}),
    });
    return this.decideWith
      ? this.decideWith(input)
      : input.explicitTargetNoteId !== undefined
        ? {
            destination: "user_memory" as const,
            action: "replace" as const,
            targetNoteId: input.explicitTargetNoteId,
            reason: "explicit correction",
          }
        : {
            destination: "user_memory" as const,
            action: "create" as const,
            reason: "new note",
          };
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
  knowledgeAccessService: new KnowledgeAccessServiceStub(),
  userMemoryStore: new MemoryStoreStub(),
  userMemoryWritePlanner: new MemoryWritePlannerStub(),
  dailyEventRepository: new DailyEventRepoStub(),
  botId: "b1",
  runtimeContext: {
    current: () => ({ botId: "b1", userId: "u1", threadId: "c1:u1" }),
  },
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
  expect(parsed[0]?.score).toBe(0.9);
});

test("remember_user_note tool stores note", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  const tools = createCustomTools(deps);

  await findTool(tools, "remember_user_note").invoke({ note: "prefer concise" });
  expect(memoryStore.notes[0]?.note).toBe("prefer concise");
});

test("semantic duplicate keeps the existing UserMemory note with one planner call", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  memoryStore.notes.push({
    id: 1,
    note: "回答は簡潔な方がよい",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const planner = new MemoryWritePlannerStub(() => ({
    destination: "user_memory",
    action: "keep_existing",
    targetNoteId: 1,
    reason: "same preference in different words",
  }));
  const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

  const result = JSON.parse(
    (await findTool(tools, "remember_user_note").invoke({
      note: "短い回答が好き",
    })) as string,
  ) as { action: string; note: { id: number } };

  expect(result).toMatchObject({ action: "keep_existing", note: { id: 1 } });
  expect(memoryStore.notes).toHaveLength(1);
  expect(planner.calls).toHaveLength(1);
});

test("semantic contradiction replaces only the selected UserMemory note", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  memoryStore.notes.push(
    {
      id: 1,
      note: "回答は簡潔な方がよい",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: 2,
      note: "TypeScriptを使っている",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  );
  const planner = new MemoryWritePlannerStub(() => ({
    destination: "user_memory",
    action: "replace",
    targetNoteId: 1,
    reason: "the preference was corrected",
  }));
  const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

  await findTool(tools, "remember_user_note").invoke({
    note: "回答は詳しい方がよい",
  });

  expect(memoryStore.replacedIds).toEqual([1]);
  expect(memoryStore.deletedIds).toEqual([]);
  expect(planner.calls).toHaveLength(1);
});

test("new UserMemory note does not mutate unrelated candidates", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  memoryStore.notes.push({
    id: 1,
    note: "TypeScriptを使っている",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const planner = new MemoryWritePlannerStub(() => ({
    destination: "user_memory",
    action: "create",
    reason: "new stable preference",
  }));
  const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

  await findTool(tools, "remember_user_note").invoke({
    note: "ダークモードが好き",
  });

  expect(memoryStore.replacedIds).toEqual([]);
  expect(memoryStore.deletedIds).toEqual([]);
  expect(memoryStore.notes.map(({ note }) => note)).toContain("ダークモードが好き");
  expect(planner.calls).toHaveLength(1);
});

test("rejects a planner target outside the candidate set", async () => {
  const deps = createDeps();
  const memoryStore = deps.userMemoryStore as MemoryStoreStub;
  const planner = new MemoryWritePlannerStub(() => ({
    destination: "user_memory",
    action: "replace",
    targetNoteId: 999,
    reason: "invalid target",
  }));
  const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

  const result = JSON.parse(
    (await findTool(tools, "remember_user_note").invoke({
      note: "詳細な回答が好き",
    })) as string,
  ) as { ok: boolean };

  expect(result.ok).toBe(false);
  expect(memoryStore.replacedIds).toEqual([]);
  expect(memoryStore.deletedIds).toEqual([]);
  expect(planner.calls).toHaveLength(1);
});

test("explicit UserMemory deletion bypasses the write planner", async () => {
  const deps = createDeps();
  const planner = deps.userMemoryWritePlanner as MemoryWritePlannerStub;
  const tools = createCustomTools(deps);

  await findTool(tools, "delete_user_note").invoke({ noteId: 1 });

  expect(planner.calls).toHaveLength(0);
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

test("search_user_notes returns IDs for explicit updates", async () => {
  const tools = createCustomTools(createDeps());

  const result = await findTool(tools, "search_user_notes").invoke({ query: "concise" });
  const parsed = JSON.parse(result as string) as Array<{ id: number; note: string }>;
  expect(parsed[0]).toMatchObject({ id: 1, note: "prefer concise" });
});

test("replace and delete user note tools operate on an explicit searched ID", async () => {
  const deps = createDeps();
  const planner = deps.userMemoryWritePlanner as MemoryWritePlannerStub;
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
  expect(planner.calls).toHaveLength(1);
});

test("explicit replacement rejects a nonexistent ID without an LLM call", async () => {
  const deps = createDeps();
  const planner = deps.userMemoryWritePlanner as MemoryWritePlannerStub;
  const tools = createCustomTools(deps);

  const result = JSON.parse(
    (await findTool(tools, "replace_user_note").invoke({
      noteId: 999,
      note: "詳細な回答が好き",
    })) as string,
  ) as { ok: boolean };

  expect(result.ok).toBe(false);
  expect(planner.calls).toHaveLength(0);
});

test.each([
  ["今日という曲が好き", "user_memory", true],
  ["2026-10-01以降も回答は簡潔にしてほしい", "user_memory", true],
  ["queueのテストを追加した", "reject", false],
  ["scheduled proactive話題への興味はpositive", "topic_state", false],
  ["覚えておいて", "reject", false],
  ["2026-05-06 にqueueのテストを追加した", "daily_event", false],
] as const)(
  "uses one semantic write decision for %s",
  async (note, destination, shouldStore) => {
    const deps = createDeps();
    const memoryStore = deps.userMemoryStore as MemoryStoreStub;
    const planner = new MemoryWritePlannerStub(() =>
      destination === "user_memory"
        ? {
            destination,
            action: "create",
            reason: "stable UserMemory",
          }
        : { destination, reason: "not UserMemory" },
    );
    const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

    const result = JSON.parse(
      (await findTool(tools, "remember_user_note").invoke({ note })) as string,
    ) as { ok: boolean; destination?: string; error?: string };

    expect(result.ok).toBe(shouldStore);
    expect(memoryStore.notes.map((item) => item.note).includes(note)).toBe(
      shouldStore,
    );
    if (!shouldStore) {
      expect(result.destination).toBe(destination);
    }
    expect(planner.calls).toHaveLength(1);
  },
);

test("daily event decision points to its explicit-date tool without transferring data", async () => {
  const deps = createDeps();
  const dailyEvents = deps.dailyEventRepository as DailyEventRepoStub;
  const planner = new MemoryWritePlannerStub(() => ({
    destination: "daily_event",
    reason: "dated concrete occurrence",
  }));
  const tools = createCustomTools({ ...deps, userMemoryWritePlanner: planner });

  const result = JSON.parse(
    (await findTool(tools, "remember_user_note").invoke({
      note: "2026-05-06 にqueueのテストを追加した",
    })) as string,
  ) as { ok: boolean; error: string };

  expect(result.ok).toBe(false);
  expect(result.error).toContain("remember_daily_event");
  expect(dailyEvents.remembered).toBeNull();
  expect(planner.calls).toHaveLength(1);
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
