import { tool } from "@langchain/core/tools";
import { z } from "zod/v3";
import { KnowledgeRepository, UserMemoryStore, WebClient } from "../../core/types";

export interface CustomToolDeps {
  knowledgeRepository: KnowledgeRepository;
  webClient: WebClient;
  userMemoryStore: UserMemoryStore;
  defaultUserId: string;
  botId: string;
  enqueueTask?: (input: {
    text: string;
    delayMinutes?: number;
    everyMinutes?: number;
    atIso?: string;
  }) => Promise<{ id: string; dueAt: string; type: "scheduled_once" | "scheduled_recurring" }>;
  getQueueStatus?: (input?: { limit?: number }) => Promise<unknown>;
}

const schemaCompat = <T>(schema: T): T => schema;

export const createCustomTools = (deps: CustomToolDeps) => {
  const webListTool = tool(
    async ({ query, k }: { query: string; k: number }) => {
      const results = await deps.webClient.webList(query, k);
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
      const page = await deps.webClient.webPage(url);
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
      const results = await deps.knowledgeRepository.searchSavedKnowledge(query, {
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
      const article = articleId
        ? await deps.knowledgeRepository.getSavedArticleById(articleId)
        : await deps.knowledgeRepository.getSavedArticleByUrl(url ?? "");
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
      const page = await deps.webClient.webPage(url);
      const saved = await deps.knowledgeRepository.saveArticle({
        url: page.url,
        title: page.title,
        summary: summarizeMarkdown(page.markdown),
        rawMarkdown: page.markdown,
      });
      return JSON.stringify({
        articleId: saved.id,
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
    async ({ note, userId }: { note: string; userId?: string }) => {
      await deps.userMemoryStore.rememberUserNote(deps.botId, userId ?? deps.defaultUserId, note);
      return JSON.stringify({ ok: true });
    },
    {
      name: "remember_user_note",
      description: "Saves user preference or policy note into persistent user memory.",
      schema: schemaCompat(z.object({
        note: z.string(),
        userId: z.string().optional(),
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

  const getUserNotesTool = tool(
    async ({ userId, limit }: { userId?: string; limit?: number }) => {
      const results = await deps.userMemoryStore.listUserNotes(
        deps.botId,
        userId ?? deps.defaultUserId,
        limit ?? 5,
      );
      return JSON.stringify(results);
    },
    {
      name: "get_user_notes",
      description: "Gets remembered notes for a user under the current bot namespace.",
      schema: schemaCompat(z.object({
        userId: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(5),
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
    getUserNotesTool,
    readMemoryFileTool,
    enqueueTaskTool,
    getQueueStatusTool,
  ];
};

const summarizeMarkdown = (markdown: string): string => {
  const trimmed = markdown.replace(/\s+/g, " ").trim();
  return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 277)}...`;
};
