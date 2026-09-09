import { Client, GatewayIntentBits } from "discord.js";
import {
  createDrizzleClient,
  createKnowledgeAccessService,
  createOllamaKnowledgeAccessAnalysisModel,
  createPostgresPool,
  OllamaEmbeddingProvider,
  PostgresKnowledgeRepository,
  SimpleWebClient,
} from "@chat-agent/knowledge-access";
import { createQueueApi, FileQueueStore } from "@chat-agent/queue";
import { DiscordBotApp } from "./ui/discord/discordBotApp";
import { DeepAgentRuntime } from "./infrastructure/agent/deepAgentRuntime";
import { loadEnv } from "./config/env";
import { DiscordJsTransport } from "./infrastructure/discord/discordJsTransport";
import {
  createOllamaChatModel,
  createOllamaChatModelCloud,
} from "./infrastructure/agent/ollamaChatModel";
import { createCustomTools } from "./infrastructure/agent/customTools";
import { AgentRuntimeContext } from "./infrastructure/agent/runtimeContext";
import { RequestContextBuilder } from "./infrastructure/agent/requestContextBuilder";
import { createCheckpointSummarizationMiddleware } from "./infrastructure/agent/checkpointSummarization";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { loadSystemPromptByBotId } from "./config/systemPromptLoader";
import { join } from "node:path";
import {
  createMemorySystemClient,
  formatPolicyCardsForPrompt,
} from "./infrastructure/memory/memorySystemClient";
import { createTurnRecorder } from "./infrastructure/memory/turnRecorder";
import { createPostgresTurnRecordReader } from "@chat-agent/memory-system";
import {
  createFileInteractionLogStore,
  createFileTopicStateStore,
  createPendingInteractionResolver,
  createOllamaDialoguePlanningModel,
  createMemoryServiceContextSource,
  createSavedKnowledgeContextSource,
  createSimplePomdpSystemService,
  createTopicStateInteractionLogContextSource,
  loadInitialDomainCandidates,
} from "@chat-agent/simple-pomdp-system";

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
    middleware?: unknown[];
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
  const checkpointSummarizationMiddleware =
    createCheckpointSummarizationMiddleware({
      model: chatModel,
      contextWindowTokens: env.deepAgentContextWindowTokens,
      triggerFraction: env.deepAgentSummarizationTriggerFraction,
      recentInteractions: env.deepAgentRecentInteractions,
      toolResultMaxChars: env.deepAgentToolResultMaxChars,
    });

  const pool = createPostgresPool(env.postgresUrl);
  const db = createDrizzleClient(pool);
  const embeddingProvider = new OllamaEmbeddingProvider(
    env.ollamaEmbeddingBaseUrl,
    env.ollamaEmbeddingModel,
  );
  const repository = new PostgresKnowledgeRepository(db, embeddingProvider);

  const memoryClient = createMemorySystemClient({
    postgresUrl: env.postgresUrl,
    ollamaBaseUrl: env.ollamaBaseUrl,
    ollamaModel: env.ollamaChatModel,
    ...(env.ollamaApiKey ? { ollamaApiKey: env.ollamaApiKey } : {}),
  });

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
  const analysisModel = createOllamaKnowledgeAccessAnalysisModel(
    env.ollamaBaseUrl,
    env.ollamaChatModel,
    env.ollamaApiKey,
  );
  const knowledgeAccessService = createKnowledgeAccessService({
    repository,
    webClient,
    analysisModel,
  });
  const queueStore = new FileQueueStore(
    join(env.queueDir, `${identity.botId}.json`),
  );
  const queueApi = createQueueApi(queueStore);
  const runtimeContext = new AgentRuntimeContext();
  const tools = createCustomTools({
    knowledgeAccessService,
    userMemoryClient: memoryClient,
    dailyEventClient: memoryClient,
    botId: identity.botId,
    runtimeContext,
    enqueueTask: async ({ text, delayMinutes, everyMinutes, atIso }) => {
      const dueAt = atIso
        ? new Date(atIso)
        : new Date(
            Date.now() + (delayMinutes ?? everyMinutes ?? 60) * 60 * 1000,
          );
      const task = await queueApi.enqueueScheduledInput({
        botId: identity.botId,
        userId: runtimeContext.current().userId,
        channelId: env.mentionChannelId,
        text,
        dueAt,
        ...(everyMinutes ? { intervalMinutes: everyMinutes } : {}),
      });
      return { id: task.id, dueAt: task.dueAt, type: task.type };
    },
    getQueueStatus: async ({ limit } = {}) =>
      queueApi.getStatus(new Date(), limit ?? 5),
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
        middleware: [checkpointSummarizationMiddleware],
      }),
    () => store,
    () => checkpointer,
    runtimeContext,
  );

  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const transport = new DiscordJsTransport(
    discordClient,
    env.allowedBotUserIds,
  );
  const turnRecordReader = createPostgresTurnRecordReader(env.postgresUrl);
  const topicStateStore = createFileTopicStateStore({
    baseDir: join(env.simplePomdpStoreDir, "topic-states"),
  });
  const interactionLogStore = createFileInteractionLogStore({
    baseDir: join(env.simplePomdpStoreDir, "interaction-logs"),
  });
  const conversationPlanner = createSimplePomdpSystemService({
    turnRecordReader,
    topicStateStore,
    interactionLogStore,
    contextSources: [
      createMemoryServiceContextSource({
        memoryService: {
          search: (input) => memoryClient.searchMemory(input),
        },
      }),
      createSavedKnowledgeContextSource({
        knowledgeAccessService,
        limit: 3,
      }),
      createTopicStateInteractionLogContextSource({
        topicStateReader: topicStateStore,
        interactionLogReader: interactionLogStore,
      }),
    ],
    plannerModel: createOllamaDialoguePlanningModel(
      env.ollamaBaseUrl,
      env.ollamaChatModel,
      env.ollamaApiKey,
    ),
    initialDomainCandidates: await loadInitialDomainCandidates(
      join(
        process.cwd(),
        "packages/simple-pomdp-system/domains/initial_domains.txt",
      ),
    ),
  });
  const pendingInteractionResolver = createPendingInteractionResolver({
    turnRecordReader,
    interactionLogStore,
  });
  const requestContextBuilder = new RequestContextBuilder(
    memoryClient,
    memoryClient,
    {
      load: async ({ botId, threadId, userId, currentContext }) => {
        const cards = await memoryClient.searchPolicyCards({
          botId,
          threadId,
          userId,
          query: currentContext,
          limit: 3,
        });
        return cards.length > 0
          ? formatPolicyCardsForPrompt(cards)
          : undefined;
      },
    },
    undefined,
  );
  const app = new DiscordBotApp(
    identity,
    runtime,
    transport,
    env.mentionChannelId,
    queueApi,
    env.discordBotUserId,
    createTurnRecorder(memoryClient),
    (input) => requestContextBuilder.build(input),
    async ({ botId, threadId, userId }) =>
      conversationPlanner.planInteraction({
        botId,
        threadId,
        userId,
        trigger: "conversation",
      }),
    (input) => conversationPlanner.assessConversationOpportunity(input),
    (input) => pendingInteractionResolver.resolve(input),
  );
  app.start();

  await discordClient.login(env.discordToken);
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stdout.write(`[discord-startup-error] ${message}\n`);
  process.exit(1);
});
