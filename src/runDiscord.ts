import { Client, GatewayIntentBits } from "discord.js";
import { DiscordBotApp } from "./ui/discord/discordBotApp";
import { DeepAgentRuntime } from "./infrastructure/agent/deepAgentRuntime";
import { SimpleWebClient } from "./infrastructure/web/simpleWebClient";
import { loadEnv } from "./config/env";
import { DiscordJsTransport } from "./infrastructure/discord/discordJsTransport";
import { createPostgresPool } from "./infrastructure/db/postgresPool";
import { createDrizzleClient } from "./infrastructure/db/drizzleClient";
import { PostgresKnowledgeRepository } from "./infrastructure/db/postgresKnowledgeRepository";
import { OllamaEmbeddingProvider } from "./infrastructure/memory/ollamaEmbeddingProvider";
import {
  createOllamaChatModel,
  createOllamaChatModelCloud,
} from "./infrastructure/agent/ollamaChatModel";
import { SimpleChatRuntime } from "./infrastructure/agent/simpleChatRuntime";
import { PostgresUserMemoryStore } from "./infrastructure/memory/postgresUserMemoryStore";
import { createCustomTools } from "./infrastructure/agent/customTools";
import { PostgresDailyEventRepository } from "./infrastructure/daily-events/postgresDailyEventRepository";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { loadSystemPromptByBotId } from "./config/systemPromptLoader";
import { FileQueueStore } from "./queue/fileQueueStore";
import { join } from "node:path";
import { analyzeArticle } from "./core/usecases/analyzeArticle";

const main = async (): Promise<void> => {
  const deepagents = await import("deepagents");
  const createDeepAgent = deepagents.createDeepAgent as unknown as (params: {
    model: unknown;
    tools: unknown[];
    systemPrompt: string;
    checkpointer?: unknown;
    store?: unknown;
    backend?: unknown;
    skills?: string[];
  }) => {
    invoke(
      input: {
        messages: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      },
      config?: { configurable?: { thread_id?: string } },
    ): Promise<{ messages?: unknown[] }>;
  };

  const env = loadEnv();
  const identity = {
    botId: env.botId,
    systemPrompt: loadSystemPromptByBotId(
      env.botId,
      process.env.SYSTEM_PROMPT ?? "You are a helpful Discord assistant.",
    ),
  };

  const chatModel = env.ollamaApiKey
    ? createOllamaChatModelCloud(
        env.ollamaBaseUrl,
        env.ollamaChatModel,
        env.ollamaApiKey,
      )
    : createOllamaChatModel(env.ollamaBaseUrl, env.ollamaChatModel);
  const articleAnalyzerRuntime = new SimpleChatRuntime(chatModel);

  const pool = createPostgresPool(env.postgresUrl);
  const db = createDrizzleClient(pool);
  const embeddingProvider = new OllamaEmbeddingProvider(
    env.ollamaEmbeddingBaseUrl,
    env.ollamaEmbeddingModel,
  );
  const repository = new PostgresKnowledgeRepository(db, embeddingProvider);

  const userMemoryStore = new PostgresUserMemoryStore(db);
  const dailyEventRepository = new PostgresDailyEventRepository(db);

  const checkpointer = PostgresSaver.fromConnString(env.postgresUrl, {
    schema: "app",
  });

  const store = PostgresStore.fromConnString(env.postgresUrl, {
    index: {
      dims: env.ollamaEmbeddingDimension,
      embed: {
        embedDocuments: (texts: string[]) =>
          Promise.all(texts.map((text) => embeddingProvider.embed(text))),
        embedQuery: (text: string) => embeddingProvider.embed(text),
      },
    },
    schema: "app",
    ensureTables: false,
  });

  const webClient = new SimpleWebClient(env.simpleClientBaseUrl);
  const queueStore = new FileQueueStore(
    join(env.queueDir, `${identity.botId}.json`),
  );
  const tools = createCustomTools({
    knowledgeRepository: repository,
    webClient,
    userMemoryStore,
    dailyEventRepository,
    defaultUserId: "discord-user",
    botId: identity.botId,
    enqueueTask: async ({ text, delayMinutes, everyMinutes, atIso }) => {
      const dueAt = atIso
        ? new Date(atIso)
        : new Date(
            Date.now() + (delayMinutes ?? everyMinutes ?? 60) * 60 * 1000,
          );
      const type = everyMinutes ? "scheduled_recurring" : "scheduled_once";
      const task = await queueStore.enqueue({
        type,
        action: "agent_input",
        text,
        channelId: env.mentionChannelId,
        authorId: "agent",
        mentionsBot: false,
        dueAt,
        ...(everyMinutes ? { intervalMinutes: everyMinutes } : {}),
      });
      return { id: task.id, dueAt: task.dueAt, type };
    },
    getQueueStatus: async ({ limit } = {}) =>
      queueStore.getStatus(new Date(), limit ?? 5),
    analyzeArticle: async ({ title, url, markdown }) =>
      analyzeArticle(
        articleAnalyzerRuntime,
        identity.botId,
        title,
        url,
        markdown,
      ),
  });

  const runtime = new DeepAgentRuntime(
    chatModel,
    tools,
    ({
      model,
      tools: configuredTools,
      systemPrompt,
      checkpointer: cp,
      store: st,
    }) =>
      createDeepAgent({
        model,
        tools: configuredTools,
        systemPrompt,
        ...(cp ? { checkpointer: cp } : {}),
        ...(st ? { store: st } : {}),
        backend: new deepagents.FilesystemBackend({ rootDir: process.cwd() }),
        skills: env.deepAgentSkillsSources,
      }),
    () => store,
    () => checkpointer,
  );

  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const transport = new DiscordJsTransport(discordClient);

  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    env.mentionChannelId,
    queueStore,
    env.discordBotUserId,
  );
  app.start();

  await discordClient.login(env.discordToken);
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stdout.write(`${message}\n`);
  process.exit(1);
});
