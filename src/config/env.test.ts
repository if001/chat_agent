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
    OLLAMA_CONTEXT_WINDOW_TOKENS: "32768",
  });

  try {
    const env = loadEnv();
    expect(env.queueDir).toBe("data/queues");
    expect(env.simplePomdpStoreDir).toBe("data/simple-pomdp-system");
    expect(env.deepAgentContextWindowTokens).toBe(32768);
    expect(env.deepAgentSummarizationTriggerFraction).toBe(0.7);
    expect(env.deepAgentRecentInteractions).toBe(4);
    expect(env.deepAgentToolResultMaxChars).toBe(8000);
  } finally {
    process.env = previous;
  }
});

test("rejects a summarization trigger at or beyond the context limit", () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    MENTION_CHANNEL_ID: "channel-1",
    DISCORD_BOT_TOKEN: "token",
    SIMPLE_CLIENT_BASE_URL: "http://localhost:3000",
    POSTGRES_URL: "postgres://localhost/app",
    OLLAMA_BASE_URL: "http://localhost:11434",
    OLLAMA_CHAT_MODEL: "test-model",
    OLLAMA_EMBEDDING_MODEL: "test-embedding",
    DEEPAGENT_SUMMARIZATION_TRIGGER_FRACTION: "1",
  });

  try {
    expect(() => loadEnv()).toThrow(
      "DEEPAGENT_SUMMARIZATION_TRIGGER_FRACTION must be less than 1",
    );
  } finally {
    process.env = previous;
  }
});
