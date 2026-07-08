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
import { loadEnv } from "./config/env";
import { loadSystemPromptByBotId } from "./config/systemPromptLoader";
import { DiscordJsTransport } from "./infrastructure/discord/discordJsTransport";
import { DiscordIngestApp } from "./ui/discord/discordIngestApp";

const main = async (): Promise<void> => {
  const env = loadEnv();
  if (!env.ingestChannelId) {
    throw new Error("INGEST_CHANNEL_ID is required for start:ingest");
  }

  const identity = {
    botId: env.botId,
    systemPrompt: loadSystemPromptByBotId(
      env.botId,
      process.env.SYSTEM_PROMPT ?? "You summarize articles clearly and concisely.",
    ),
  };

  const pool = createPostgresPool(env.postgresUrl);
  const db = createDrizzleClient(pool);
  const embeddingProvider = new OllamaEmbeddingProvider(
    env.ollamaEmbeddingBaseUrl,
    env.ollamaEmbeddingModel,
  );
  const repository = new PostgresKnowledgeRepository(db, embeddingProvider);
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

  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const transport = new DiscordJsTransport(discordClient);
  const app = new DiscordIngestApp(
    identity,
    knowledgeAccessService,
    transport,
    env.ingestChannelId,
  );
  app.start();

  await discordClient.login(env.discordToken);
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
