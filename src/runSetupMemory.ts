import { loadEnv } from "./config/env";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { OllamaEmbeddingProvider } from "./infrastructure/memory/ollamaEmbeddingProvider";

const main = async (): Promise<void> => {
  const env = loadEnv();
  const adminPostgresUrl = env.adminPostgresUrl ?? env.postgresUrl;
  const embeddingProvider = new OllamaEmbeddingProvider(
    env.ollamaEmbeddingBaseUrl,
    env.ollamaEmbeddingModel,
  );

  const checkpointer = PostgresSaver.fromConnString(adminPostgresUrl, {
    schema: "app",
  });
  await checkpointer.setup();

  const store = PostgresStore.fromConnString(adminPostgresUrl, {
    index: {
      dims: env.ollamaEmbeddingDimension,
      embed: {
        embedDocuments: (texts: string[]) =>
          Promise.all(texts.map((text) => embeddingProvider.embed(text))),
        embedQuery: (text: string) => embeddingProvider.embed(text),
      },
    },
    schema: "app",
  });
  await store.setup();

  process.stdout.write("memory setup completed\n");
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
