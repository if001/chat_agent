import { Client, GatewayIntentBits } from "discord.js";
import { loadEnv } from "./config/env";
import { loadSystemPromptByBotId } from "./config/systemPromptLoader";
import { DiscordJsTransport } from "./infrastructure/discord/discordJsTransport";
import { createPostgresPool } from "./infrastructure/db/postgresPool";
import { createDrizzleClient } from "./infrastructure/db/drizzleClient";
import { PostgresKnowledgeRepository } from "./infrastructure/db/postgresKnowledgeRepository";
import { OllamaEmbeddingProvider } from "./infrastructure/memory/ollamaEmbeddingProvider";
import { SimpleWebClient } from "./infrastructure/web/simpleWebClient";
import { DiscordIngestApp } from "./ui/discord/discordIngestApp";
import { SimpleChatRuntime } from "./infrastructure/agent/simpleChatRuntime";
import { createOllamaChatModel, createOllamaChatModelCloud } from "./infrastructure/agent/ollamaChatModel";

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

  const chatModel = env.ollamaApiKey
    ? createOllamaChatModelCloud(
        env.ollamaBaseUrl,
        env.ollamaChatModel,
        env.ollamaApiKey,
      )
    : createOllamaChatModel(env.ollamaBaseUrl, env.ollamaChatModel);
  const runtime = new SimpleChatRuntime(chatModel);

  const pool = createPostgresPool(env.postgresUrl);
  const db = createDrizzleClient(pool);
  const embeddingProvider = new OllamaEmbeddingProvider(
    env.ollamaEmbeddingBaseUrl,
    env.ollamaEmbeddingModel,
  );
  const repository = new PostgresKnowledgeRepository(db, embeddingProvider);
  const webClient = new SimpleWebClient(env.simpleClientBaseUrl);

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
    runtime,
    repository,
    webClient,
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
