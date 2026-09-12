import { tool } from "@langchain/core/tools";
import { KnowledgeAccessService } from "@chat-agent/knowledge-access";
import { z } from "zod/v3";
import { TrustedAgentContext } from "./runtimeContext";
import { MemorySystemClient } from "../memory/memorySystemClient";

interface TrustedContextReader {
  current(): TrustedAgentContext;
}

export interface CustomToolDeps {
  knowledgeAccessService: KnowledgeAccessService;
  memoryClient: Pick<
    MemorySystemClient,
    | "rememberUserNote"
    | "findUserNotesForManagement"
    | "replaceUserNote"
    | "deleteUserNote"
    | "rememberDailyEvent"
    | "inspectCatalog"
    | "searchMemory"
  >;
  botId: string;
  runtimeContext: TrustedContextReader;
  enqueueTask?: (input: {
    text: string;
    delayMinutes?: number;
    everyMinutes?: number;
    atIso?: string;
  }) => Promise<{
    id: string;
    dueAt: string;
    type: "scheduled_once" | "scheduled_recurring";
  }>;
  getQueueStatus?: (input?: { limit?: number }) => Promise<unknown>;
}

const schemaCompat = <T>(schema: T): T => schema;

export const createCustomTools = (deps: CustomToolDeps) => {
  const trustedScope = () => {
    const context = deps.runtimeContext.current();
    return {
      botId: context.botId,
      threadId: context.threadId,
      userId: context.userId,
    };
  };

  const searchMemory = async (
    input: Parameters<MemorySystemClient["searchMemory"]>[0],
    resultKey:
      | "conversationHistory"
      | "userMemory"
      | "dailyEvents"
      | "policyCards",
  ) => {
    try {
      const result = await retryTransient(() =>
        deps.memoryClient.searchMemory(input),
      );
      return (
        result[resultKey] ?? {
          status: "unavailable",
          reason: `${resultKey} result was omitted`,
        }
      );
    } catch {
      return {
        status: "unavailable",
        reason: "Memory search failed",
      };
    }
  };

  const inspectContextCatalogTool = tool(
    async ({ query }: { query?: string }) => {
      const scope = trustedScope();
      const [memory, knowledge] = await Promise.all([
        loadCatalog(
          () =>
            deps.memoryClient.inspectCatalog({
              ...scope,
              ...(query?.trim() ? { query: query.trim() } : {}),
            }),
          "memory catalog",
        ),
        loadCatalog(
          () => deps.knowledgeAccessService.inspectCatalog(),
          "knowledge catalog",
        ),
      ]);
      const memoryReasons = sanitizeCatalogReasons(memory, "memory catalog");
      const knowledgeReasons = sanitizeCatalogReasons(
        knowledge,
        "knowledge catalog",
      );
      console.log("call inspectContextCatalogTool: memory", memoryReasons);
      console.log(
        "call inspectContextCatalogTool: knowledge",
        knowledgeReasons,
      );
      return JSON.stringify({
        memory: memoryReasons,
        knowledge: knowledgeReasons,
      });
    },
    {
      name: "inspect_context_catalog",
      description:
        "Lists lightweight topic hints for available memories and saved knowledge. Use it before detailed retrieval when past context may matter; it does not return memory bodies.",
      schema: schemaCompat(
        z.object({ query: z.string().max(500).optional() }),
      ) as never,
    },
  );

  const searchConversationMemoryTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const result = await searchMemory(
        {
          ...trustedScope(),
          query,
          scopes: ["conversation_history"],
          limits: { conversation_history: limit ?? 5 },
        },
        "conversationHistory",
      );
      return JSON.stringify(result);
    },
    {
      name: "search_conversation_memory",
      description:
        "Searches older related conversation excerpts after catalog inspection. Runtime identity scope is applied automatically.",
      schema: schemaCompat(
        z.object({
          query: z.string().min(1).max(500),
          limit: z.number().int().min(1).max(10).default(5),
        }),
      ) as never,
    },
  );

  const searchUserMemoryTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const result = await searchMemory(
        {
          ...trustedScope(),
          query,
          scopes: ["user_memory"],
          limits: { user_memory: limit ?? 5 },
        },
        "userMemory",
      );
      return JSON.stringify(result);
    },
    {
      name: "search_user_memory",
      description:
        "Searches durable user preferences, constraints, attributes, and ongoing assumptions. Runtime user scope is automatic.",
      schema: schemaCompat(
        z.object({
          query: z.string().min(1).max(500),
          limit: z.number().int().min(1).max(10).default(5),
        }),
      ) as never,
    },
  );

  const searchResponsePoliciesTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const result = await searchMemory(
        {
          ...trustedScope(),
          query,
          scopes: ["policy_cards"],
          limits: { policy_cards: Math.min(limit ?? 3, 3) },
        },
        "policyCards",
      );
      return JSON.stringify(result);
    },
    {
      name: "search_response_policies",
      description:
        "Searches bot-specific procedural response guidance. Runtime bot and thread scope is automatic.",
      schema: schemaCompat(
        z.object({
          query: z.string().min(1).max(500),
          limit: z.number().int().min(1).max(3).default(3),
        }),
      ) as never,
    },
  );

  const webListTool = tool(
    async ({ query, k }: { query: string; k: number }) => {
      const results = await deps.knowledgeAccessService.webList({
        query,
        limit: k,
      });
      return JSON.stringify({ query, k, results });
    },
    {
      name: "web_list",
      description: "Searches web and returns list results by query.",
      schema: schemaCompat(
        z.object({
          query: z.string(),
          k: z.number().int().min(1).max(20).default(5),
        }),
      ) as never,
    },
  );

  const webPageTool = tool(
    async ({ url }: { url: string }) => {
      const page = await deps.knowledgeAccessService.webPage({ url });
      return JSON.stringify(page);
    },
    {
      name: "web_page",
      description: "Fetches a web page and returns url/title/markdown.",
      schema: schemaCompat(
        z.object({
          url: z.string().url(),
        }),
      ) as never,
    },
  );

  const searchSavedKnowledgeTool = tool(
    async ({
      query,
      limit,
      minScore,
    }: {
      query: string;
      limit?: number;
      minScore?: number;
    }) => {
      const results = await retryTransient(() =>
        deps.knowledgeAccessService.searchSavedKnowledge({
          query,
          ...(limit ? { limit } : {}),
          ...(minScore !== undefined ? { minScore } : {}),
        }),
      );
      return JSON.stringify(
        results.map(({ score, ...item }) => {
          void score;
          return item;
        }),
      );
    },
    {
      name: "search_saved_knowledge",
      description: "Searches saved shared knowledge from Postgres/pgvector.",
      schema: schemaCompat(
        z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(20).optional(),
          minScore: z.number().min(0).max(1).optional(),
        }),
      ) as never,
    },
  );

  const getSavedArticleTool = tool(
    async ({
      articleId,
      url,
      detail,
    }: {
      articleId?: string;
      url?: string;
      detail?: "summary" | "content";
    }) => {
      if (!articleId && !url) {
        return JSON.stringify({ error: "articleId or url is required" });
      }
      const article = await retryTransient(() =>
        deps.knowledgeAccessService.getSavedArticle({
          ...(articleId ? { articleId } : {}),
          ...(url ? { url } : {}),
        }),
      );
      if (!article) {
        return JSON.stringify(null);
      }
      const base = {
        id: article.id,
        url: article.url,
        title: article.title,
        summary: article.summary,
        tags: article.tags,
        createdAt: article.createdAt,
      };
      return JSON.stringify(
        detail === "content" ? { ...base, content: article.content } : base,
      );
    },
    {
      name: "get_saved_article",
      description:
        "Gets a shared saved article. Defaults to summary metadata; request content or raw detail only when necessary.",
      schema: schemaCompat(
        z.object({
          articleId: z.string().optional(),
          url: z.string().url().optional(),
          detail: z.enum(["summary", "content"]).default("summary"),
        }),
      ) as never,
    },
  );

  const saveWebKnowledgeTool = tool(
    async ({ url }: { url: string }) => {
      const saved = await deps.knowledgeAccessService.saveWebKnowledge({
        botId: deps.botId,
        url,
      });
      return JSON.stringify({
        articleId: saved.articleId,
        title: saved.title,
        summary: saved.summary,
        url: saved.url,
      });
    },
    {
      name: "save_web_knowledge",
      description:
        "Fetches and saves a page as shared knowledge. Use only when the user explicitly asks to save or remember that URL.",
      schema: schemaCompat(
        z.object({
          url: z.string().url(),
        }),
      ) as never,
    },
  );

  const rememberUserNoteTool = tool(
    async ({ note }: { note: string }) => {
      return JSON.stringify(
        await deps.memoryClient.rememberUserNote(
          deps.runtimeContext.current().userId,
          note,
        ),
      );
    },
    {
      name: "remember_user_note",
      description:
        "Saves stable user context. Deduplicates equivalent notes; do not use for dated events or proactive-topic reactions.",
      schema: schemaCompat(
        z.object({
          note: z.string(),
        }),
      ) as never,
    },
  );

  const searchUserNotesTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const results = await deps.memoryClient.findUserNotesForManagement(
        deps.runtimeContext.current().userId,
        query,
        limit ?? 5,
      );
      return JSON.stringify(results);
    },
    {
      name: "search_user_notes",
      description:
        "Searches shared UserMemory notes and returns their IDs for explicit replacement or deletion.",
      schema: schemaCompat(
        z.object({
          query: z.string().default(""),
          limit: z.number().int().min(1).max(20).default(5),
        }),
      ) as never,
    },
  );

  const replaceUserNoteTool = tool(
    async ({ noteId, note }: { noteId: number; note: string }) => {
      return JSON.stringify(
        await deps.memoryClient.replaceUserNote(
          deps.runtimeContext.current().userId,
          noteId,
          note,
        ),
      );
    },
    {
      name: "replace_user_note",
      description:
        "Replaces one searched UserMemory note by its ID for an explicit user correction.",
      schema: schemaCompat(
        z.object({
          noteId: z.number().int().positive(),
          note: z.string(),
        }),
      ) as never,
    },
  );

  const deleteUserNoteTool = tool(
    async ({ noteId }: { noteId: number }) => {
      const deleted = await deps.memoryClient.deleteUserNote(
        deps.runtimeContext.current().userId,
        noteId,
      );
      return JSON.stringify({ ok: deleted });
    },
    {
      name: "delete_user_note",
      description:
        "Deletes one searched UserMemory note by its ID after an explicit user request.",
      schema: schemaCompat(
        z.object({
          noteId: z.number().int().positive(),
        }),
      ) as never,
    },
  );

  const rememberDailyEventTool = tool(
    async ({
      eventDate,
      summary,
      tags,
      sourceMessage,
    }: {
      eventDate: string;
      summary: string;
      tags?: string[];
      sourceMessage?: string;
    }) => {
      const saved = await deps.memoryClient.rememberDailyEvent({
        userId: deps.runtimeContext.current().userId,
        eventDate,
        summary,
        ...(tags ? { tags } : {}),
        ...(sourceMessage ? { sourceMessage } : {}),
      });
      return JSON.stringify(saved);
    },
    {
      name: "remember_daily_event",
      description:
        "Stores a short daily record of what the user did on a specific date.",
      schema: schemaCompat(
        z.object({
          eventDate: z.string(),
          summary: z.string(),
          tags: z.array(z.string()).optional(),
          sourceMessage: z.string().optional(),
        }),
      ) as never,
    },
  );

  const searchDailyEventsTool = tool(
    async ({
      query,
      limit,
      fromDate,
      toDate,
    }: {
      query: string;
      limit?: number;
      fromDate?: string;
      toDate?: string;
    }) => {
      const result = await searchMemory(
        {
          ...trustedScope(),
          query,
          scopes: ["daily_events"],
          limits: { daily_events: Math.min(limit ?? 5, 10) },
          ...(fromDate || toDate
            ? {
                filters: {
                  dailyEvents: {
                    ...(fromDate ? { from: fromDate } : {}),
                    ...(toDate ? { to: toDate } : {}),
                  },
                },
              }
            : {}),
        },
        "dailyEvents",
      );
      return JSON.stringify(result);
    },
    {
      name: "search_daily_events",
      description:
        "Searches short daily user activity records by text and optional date range.",
      schema: schemaCompat(
        z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(20).optional(),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
        }),
      ) as never,
    },
  );

  const getDailyEventsByDateTool = tool(
    async ({
      date,
      windowDays,
      limit,
    }: {
      date: string;
      windowDays?: number;
      limit?: number;
    }) => {
      const range = dailyEventDateRange(date, windowDays ?? 3);
      const result = await searchMemory(
        {
          ...trustedScope(),
          query: "",
          scopes: ["daily_events"],
          limits: { daily_events: Math.min(limit ?? 20, 50) },
          filters: { dailyEvents: range },
        },
        "dailyEvents",
      );
      return JSON.stringify(result);
    },
    {
      name: "get_daily_events_by_date",
      description: "Gets daily user activity records around a specific date.",
      schema: schemaCompat(
        z.object({
          date: z.string(),
          windowDays: z.number().int().min(0).max(30).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
      ) as never,
    },
  );

  const enqueueTaskTool = tool(
    async ({
      text,
      delayMinutes,
      everyMinutes,
      atIso,
    }: {
      text: string;
      delayMinutes?: number;
      everyMinutes?: number;
      atIso?: string;
    }) => {
      if (!deps.enqueueTask) {
        return JSON.stringify({ error: "queue backend is not configured" });
      }
      const created = await deps.enqueueTask({
        text,
        ...(delayMinutes !== undefined ? { delayMinutes } : {}),
        ...(everyMinutes !== undefined ? { everyMinutes } : {}),
        ...(atIso !== undefined ? { atIso } : {}),
      });
      return JSON.stringify({
        ok: true,
        message: `queueを作成しました: id=${created.id}, dueAt=${created.dueAt}, type=${created.type}`,
      });
    },
    {
      name: "enqueue_task",
      description: "Schedules a future task for the agent queue.",
      schema: schemaCompat(
        z.object({
          text: z.string(),
          delayMinutes: z.number().int().min(1).optional(),
          everyMinutes: z.number().int().min(1).optional(),
          atIso: z.string().optional(),
        }),
      ) as never,
    },
  );

  const getQueueStatusTool = tool(
    async ({ limit }: { limit?: number }) => {
      if (!deps.getQueueStatus) {
        return JSON.stringify({ error: "queue backend is not configured" });
      }
      const status = await deps.getQueueStatus(
        limit !== undefined ? { limit } : undefined,
      );
      return JSON.stringify(status);
    },
    {
      name: "get_queue_status",
      description: "Returns current queue status (counts and upcoming tasks).",
      schema: schemaCompat(
        z.object({
          limit: z.number().int().min(0).max(20).default(5).optional(),
        }),
      ) as never,
    },
  );

  return [
    inspectContextCatalogTool,
    searchConversationMemoryTool,
    searchUserMemoryTool,
    searchResponsePoliciesTool,
    webListTool,
    webPageTool,
    saveWebKnowledgeTool,
    searchSavedKnowledgeTool,
    getSavedArticleTool,
    rememberUserNoteTool,
    searchUserNotesTool,
    replaceUserNoteTool,
    deleteUserNoteTool,
    rememberDailyEventTool,
    searchDailyEventsTool,
    getDailyEventsByDateTool,
    enqueueTaskTool,
    getQueueStatusTool,
  ];
};

const retryTransient = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!isTransientError(error)) {
      throw error;
    }
    return operation();
  }
};

const loadCatalog = async <T>(
  load: () => Promise<T>,
  label: string,
): Promise<
  | T
  | {
      status: "unavailable";
      available: false;
      topics: never[];
      reason: string;
    }
> => {
  try {
    return await load();
  } catch {
    return {
      status: "unavailable",
      available: false,
      topics: [],
      reason: `${label} failed`,
    };
  }
};

const isTransientError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /(timeout|timed out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|502|503|504)/i.test(
    message,
  );
};

const dailyEventDateRange = (
  date: string,
  windowDays: number,
): { from: string; to: string } => {
  const normalized = /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new TypeError("date must use YYYY-MM-DD or YYYYMMDD format");
  }
  const center = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(center.getTime()) ||
    center.toISOString().slice(0, 10) !== normalized
  ) {
    throw new TypeError("date must be a valid calendar date");
  }
  const format = (delta: number): string => {
    const value = new Date(center);
    value.setUTCDate(value.getUTCDate() + delta);
    return value.toISOString().slice(0, 10);
  };
  return { from: format(-windowDays), to: format(windowDays) };
};

const sanitizeCatalogReasons = <T>(value: T, label: string): T =>
  JSON.parse(
    JSON.stringify(value, (key, item: unknown) =>
      key === "reason" && typeof item === "string"
        ? `${label} unavailable`
        : item,
    ),
  ) as T;
