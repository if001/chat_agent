import { config } from "dotenv";

if (!process.env.DISCORD_BOT_TOKEN && !process.env.POSTGRES_URL) {
  config();
}

export interface AppEnv {
  botId: string;
  discordBotUserId?: string;
  allowedBotUserIds: string[];
  mentionChannelId: string;
  ingestChannelId?: string;
  discordToken: string;
  simpleClientBaseUrl: string;
  postgresUrl: string;
  adminPostgresUrl?: string;
  ollamaBaseUrl: string;
  ollamaApiKey?: string;
  ollamaEmbeddingBaseUrl: string;
  ollamaChatModel: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDimension: number;
  deepAgentSkillsSources: string[];
  deepAgentContextWindowTokens: number;
  deepAgentSummarizationTriggerFraction: number;
  deepAgentRecentInteractions: number;
  deepAgentToolResultMaxChars: number;
  queueDir: string;
  simplePomdpStoreDir: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const positiveNumber = (name: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
};

const positiveInteger = (name: string, value: string): number => {
  const parsed = positiveNumber(name, value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

const fractionBeforeLimit = (name: string, value: string): number => {
  const parsed = positiveNumber(name, value);
  if (parsed >= 1) {
    throw new Error(`${name} must be less than 1`);
  }
  return parsed;
};

export const loadEnv = (): AppEnv => ({
  botId: process.env.BOT_ID ?? "ao",
  ...(process.env.DISCORD_BOT_USER_ID
    ? { discordBotUserId: process.env.DISCORD_BOT_USER_ID }
    : {}),
  allowedBotUserIds: (process.env.ALLOWED_BOT_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
  mentionChannelId: required("MENTION_CHANNEL_ID"),
  ...(process.env.INGEST_CHANNEL_ID
    ? { ingestChannelId: process.env.INGEST_CHANNEL_ID }
    : {}),
  discordToken: required("DISCORD_BOT_TOKEN"),
  simpleClientBaseUrl: required("SIMPLE_CLIENT_BASE_URL"),
  postgresUrl: required("POSTGRES_URL"),
  ...(process.env.ADMIN_POSTGRES_URL
    ? { adminPostgresUrl: process.env.ADMIN_POSTGRES_URL }
    : {}),
  ollamaBaseUrl: required("OLLAMA_BASE_URL"),
  ...(process.env.OLLAMA_API_KEY
    ? { ollamaApiKey: process.env.OLLAMA_API_KEY }
    : {}),
  ollamaEmbeddingBaseUrl:
    process.env.OLLAMA_EMBEDDING_BASE_URL ?? required("OLLAMA_BASE_URL"),
  ollamaChatModel: required("OLLAMA_CHAT_MODEL"),
  ollamaEmbeddingModel: required("OLLAMA_EMBEDDING_MODEL"),
  ollamaEmbeddingDimension: Number(
    process.env.OLLAMA_EMBEDDING_DIMENSION ?? "1024",
  ),
  deepAgentSkillsSources: (
    process.env.DEEPAGENT_SKILLS_SOURCES ?? "/src/skills/"
  )
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
  deepAgentContextWindowTokens: positiveInteger(
    "OLLAMA_CONTEXT_WINDOW_TOKENS",
    process.env.OLLAMA_CONTEXT_WINDOW_TOKENS ?? "32768",
  ),
  deepAgentSummarizationTriggerFraction: fractionBeforeLimit(
    "DEEPAGENT_SUMMARIZATION_TRIGGER_FRACTION",
    process.env.DEEPAGENT_SUMMARIZATION_TRIGGER_FRACTION ?? "0.7",
  ),
  deepAgentRecentInteractions: positiveInteger(
    "DEEPAGENT_RECENT_INTERACTIONS",
    process.env.DEEPAGENT_RECENT_INTERACTIONS ?? "4",
  ),
  deepAgentToolResultMaxChars: positiveInteger(
    "DEEPAGENT_TOOL_RESULT_MAX_CHARS",
    process.env.DEEPAGENT_TOOL_RESULT_MAX_CHARS ?? "8000",
  ),
  queueDir: process.env.QUEUE_DIR ?? "data/queues",
  simplePomdpStoreDir:
    process.env.SIMPLE_POMDP_STORE_DIR ?? "data/simple-pomdp-system",
});
