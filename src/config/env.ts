import { config } from "dotenv";

config();

export interface AppEnv {
  botId: string;
  discordToken: string;
  simpleClientBaseUrl: string;
  postgresUrl: string;
  ollamaBaseUrl: string;
  ollamaApiKey?: string;
  ollamaEmbeddingBaseUrl: string;
  ollamaChatModel: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDimension: number;
  deepAgentSkillsSources: string[];
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

export const loadEnv = (): AppEnv => ({
  botId: process.env.BOT_ID ?? "ao",
  discordToken: required("DISCORD_BOT_TOKEN"),
  simpleClientBaseUrl: required("SIMPLE_CLIENT_BASE_URL"),
  postgresUrl: required("POSTGRES_URL"),
  ollamaBaseUrl: required("OLLAMA_BASE_URL"),
  ...(process.env.OLLAMA_API_KEY ? { ollamaApiKey: process.env.OLLAMA_API_KEY } : {}),
  ollamaEmbeddingBaseUrl: process.env.OLLAMA_EMBEDDING_BASE_URL ?? required("OLLAMA_BASE_URL"),
  ollamaChatModel: required("OLLAMA_CHAT_MODEL"),
  ollamaEmbeddingModel: required("OLLAMA_EMBEDDING_MODEL"),
  ollamaEmbeddingDimension: Number(process.env.OLLAMA_EMBEDDING_DIMENSION ?? "1024"),
  deepAgentSkillsSources: (process.env.DEEPAGENT_SKILLS_SOURCES ?? "/src/skills/")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
});
