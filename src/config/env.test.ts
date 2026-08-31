import { loadEnv } from "./env";

test("startup config loads without removed subsystem settings", () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    MENTION_CHANNEL_ID: "channel-1",
    DISCORD_BOT_TOKEN: "token",
    SIMPLE_CLIENT_BASE_URL: "http://localhost:3000",
    POSTGRES_URL: "postgres://localhost/app",
    OLLAMA_BASE_URL: "http://localhost:11434",
    OLLAMA_CHAT_MODEL: "test-model",
    OLLAMA_EMBEDDING_MODEL: "test-embedding",
  });

  try {
    const env = loadEnv();
    expect(env.queueDir).toBe("data/queues");
    expect(env.simplePomdpStoreDir).toBe("data/simple-pomdp-system");
  } finally {
    process.env = previous;
  }
});
