import { tool } from "@langchain/core/tools";
import { KnowledgeAccessService } from "@chat-agent/knowledge-access";
import { z } from "zod/v3";
import {
  DailyEventRepository,
  UserMemoryStore,
} from "../../core/types";
import { TrustedAgentContext } from "./runtimeContext";

interface TrustedContextReader {
  current(): TrustedAgentContext;
}

export interface CustomToolDeps {
  knowledgeAccessService: KnowledgeAccessService;
  userMemoryStore: UserMemoryStore;
  dailyEventRepository?: DailyEventRepository;
  botId: string;
  runtimeContext: TrustedContextReader;
  enqueueTask?: (input: {
    text: string;
    delayMinutes?: number;
    everyMinutes?: number;
    atIso?: string;
  }) => Promise<{ id: string; dueAt: string; type: "scheduled_once" | "scheduled_recurring" }>;
  getQueueStatus?: (input?: { limit?: number }) => Promise<unknown>;
}

const schemaCompat = <T>(schema: T): T => schema;

export type MemoryDestination = "user_memory" | "daily_event" | "topic_state";

export const classifyMemoryDestination = (note: string): MemoryDestination => {
  if (
    /(?:\b\d{4}-\d{1,2}-\d{1,2}\b|\b(?:today|yesterday|tomorrow)\b|今日|昨日|明日|先週|今週)/iu.test(
      note,
    )
  ) {
    return "daily_event";
  }
  if (
    /(?:(?:proactive|自発的|scheduled|conversation trigger).*(?:interest|興味|反応)|(?:interest|興味|反応).*(?:proactive|自発的|scheduled|conversation trigger))/iu.test(
      note,
    )
  ) {
    return "topic_state";
  }
  return "user_memory";
};

export const createCustomTools = (deps: CustomToolDeps) => {
  const requireDailyEventRepository = (): DailyEventRepository => {
    if (!deps.dailyEventRepository) {
      throw new Error("daily event backend is not configured");
    }
    return deps.dailyEventRepository;
  };

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
      schema: schemaCompat(z.object({
        query: z.string(),
        k: z.number().int().min(1).max(20).default(5),
      })) as never,
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
      schema: schemaCompat(z.object({
        url: z.string().url(),
      })) as never,
    },
  );

  const searchSavedKnowledgeTool = tool(
    async ({ query, limit, minScore }: { query: string; limit?: number; minScore?: number }) => {
      const results = await deps.knowledgeAccessService.searchSavedKnowledge({
        query,
        ...(limit ? { limit } : {}),
        ...(minScore !== undefined ? { minScore } : {}),
      });
      return JSON.stringify(results);
    },
    {
      name: "search_saved_knowledge",
      description: "Searches saved shared knowledge from Postgres/pgvector.",
      schema: schemaCompat(z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
        minScore: z.number().min(0).max(1).optional(),
      })) as never,
    },
  );

  const getSavedArticleTool = tool(
    async ({ articleId, url, includeRaw }: { articleId?: string; url?: string; includeRaw?: boolean }) => {
      if (!articleId && !url) {
        return JSON.stringify({ error: "articleId or url is required" });
      }
      const article = await deps.knowledgeAccessService.getSavedArticle({
        ...(articleId ? { articleId } : {}),
        ...(url ? { url } : {}),
      });
      if (!article) {
        return JSON.stringify(null);
      }
      if (includeRaw) {
        return JSON.stringify(article);
      }
      return JSON.stringify({
        id: article.id,
        url: article.url,
        title: article.title,
        summary: article.summary,
        content: article.content,
        tags: article.tags,
        createdAt: article.createdAt,
      });
    },
    {
      name: "get_saved_article",
      description: "Gets saved article by articleId or url. Raw markdown is optional.",
      schema: schemaCompat(z.object({
        articleId: z.string().optional(),
        url: z.string().url().optional(),
        includeRaw: z.boolean().default(false),
      })) as never,
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
      description: "Fetches web page content and saves it as shared knowledge.",
      schema: schemaCompat(z.object({
        url: z.string().url(),
      })) as never,
    },
  );

  const rememberUserNoteTool = tool(
    async ({ note }: { note: string }) => {
      const destination = classifyMemoryDestination(note);
      if (destination !== "user_memory") {
        return JSON.stringify({
          ok: false,
          error: `This content belongs in ${destination}, not UserMemory.`,
        });
      }
      const saved = await deps.userMemoryStore.rememberUserNote(
        deps.runtimeContext.current().userId,
        note,
      );
      return JSON.stringify({ ok: true, note: saved });
    },
    {
      name: "remember_user_note",
      description: "Saves stable user context. Deduplicates equivalent notes; do not use for dated events or proactive-topic reactions.",
      schema: schemaCompat(z.object({
        note: z.string(),
      })) as never,
    },
  );

  const readMemoryFileTool = tool(
    async ({ path }: { path: string }) => {
      const content = await deps.userMemoryStore.readMemoryFile(path);
      return JSON.stringify({ path, content });
    },
    {
      name: "read_memory_file",
      description: "Reads local memory file path such as /memories/research-notes.md.",
      schema: schemaCompat(z.object({
        path: z.string(),
      })) as never,
    },
  );

  const searchUserNotesTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const results = await deps.userMemoryStore.searchUserNotes(
        deps.runtimeContext.current().userId,
        query,
        limit ?? 5,
      );
      return JSON.stringify(results);
    },
    {
      name: "search_user_notes",
      description: "Searches shared UserMemory notes and returns their IDs for explicit replacement or deletion.",
      schema: schemaCompat(z.object({
        query: z.string().default(""),
        limit: z.number().int().min(1).max(20).default(5),
      })) as never,
    },
  );

  const replaceUserNoteTool = tool(
    async ({ noteId, note }: { noteId: number; note: string }) => {
      const destination = classifyMemoryDestination(note);
      if (destination !== "user_memory") {
        return JSON.stringify({
          ok: false,
          error: `This content belongs in ${destination}, not UserMemory.`,
        });
      }
      const saved = await deps.userMemoryStore.replaceUserNote(
        deps.runtimeContext.current().userId,
        noteId,
        note,
      );
      return JSON.stringify({ ok: saved !== null, note: saved });
    },
    {
      name: "replace_user_note",
      description: "Replaces one searched UserMemory note by its ID for an explicit user correction.",
      schema: schemaCompat(z.object({
        noteId: z.number().int().positive(),
        note: z.string(),
      })) as never,
    },
  );

  const deleteUserNoteTool = tool(
    async ({ noteId }: { noteId: number }) => {
      const deleted = await deps.userMemoryStore.deleteUserNote(
        deps.runtimeContext.current().userId,
        noteId,
      );
      return JSON.stringify({ ok: deleted });
    },
    {
      name: "delete_user_note",
      description: "Deletes one searched UserMemory note by its ID after an explicit user request.",
      schema: schemaCompat(z.object({
        noteId: z.number().int().positive(),
      })) as never,
    },
  );

  const rememberDailyEventTool = tool(
    async ({ eventDate, summary, tags, sourceMessage }: {
      eventDate: string;
      summary: string;
      tags?: string[];
      sourceMessage?: string;
    }) => {
      const dailyEventRepository = requireDailyEventRepository();
      const saved = await dailyEventRepository.rememberDailyEvent({
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
      description: "Stores a short daily record of what the user did on a specific date.",
      schema: schemaCompat(z.object({
        eventDate: z.string(),
        summary: z.string(),
        tags: z.array(z.string()).optional(),
        sourceMessage: z.string().optional(),
      })) as never,
    },
  );

  const searchDailyEventsTool = tool(
    async ({ query, limit, fromDate, toDate }: {
      query: string;
      limit?: number;
      fromDate?: string;
      toDate?: string;
    }) => {
      const dailyEventRepository = requireDailyEventRepository();
      const results = await dailyEventRepository.searchDailyEvents({
        userId: deps.runtimeContext.current().userId,
        query,
        ...(limit ? { limit } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
      });
      return JSON.stringify(results);
    },
    {
      name: "search_daily_events",
      description: "Searches short daily user activity records by text and optional date range.",
      schema: schemaCompat(z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })) as never,
    },
  );

  const getDailyEventsByDateTool = tool(
    async ({ date, windowDays, limit }: {
      date: string;
      windowDays?: number;
      limit?: number;
    }) => {
      const dailyEventRepository = requireDailyEventRepository();
      const results = await dailyEventRepository.getDailyEventsByDate({
        userId: deps.runtimeContext.current().userId,
        date,
        ...(windowDays !== undefined ? { windowDays } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return JSON.stringify(results);
    },
    {
      name: "get_daily_events_by_date",
      description: "Gets daily user activity records around a specific date.",
      schema: schemaCompat(z.object({
        date: z.string(),
        windowDays: z.number().int().min(0).max(30).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })) as never,
    },
  );

  const enqueueTaskTool = tool(
    async ({ text, delayMinutes, everyMinutes, atIso }: { text: string; delayMinutes?: number; everyMinutes?: number; atIso?: string }) => {
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
      schema: schemaCompat(z.object({
        text: z.string(),
        delayMinutes: z.number().int().min(1).optional(),
        everyMinutes: z.number().int().min(1).optional(),
        atIso: z.string().optional(),
      })) as never,
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
      schema: schemaCompat(z.object({
        limit: z.number().int().min(0).max(20).default(5).optional(),
      })) as never,
    },
  );

  return [
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
    readMemoryFileTool,
    enqueueTaskTool,
    getQueueStatusTool,
  ];
};
