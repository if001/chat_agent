import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DeepAgentRuntime } from "./infrastructure/agent/deepAgentRuntime";
import { TerminalChatApp } from "./ui/terminal/terminalChatApp";
import {
  createOllamaChatModel,
  createOllamaChatModelCloud,
} from "./infrastructure/agent/ollamaChatModel";
import { loadEnv } from "./config/env";
import { loadSystemPromptByBotId } from "./config/systemPromptLoader";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph-checkpoint";
import { patchLangChainUuidV4 } from "./infrastructure/agent/langchainCompat";

const main = async (): Promise<void> => {
  patchLangChainUuidV4();
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
      input: { messages: Array<{ role: "user" | "assistant" | "system"; content: string }> },
      config?: { configurable?: { thread_id?: string } },
    ): Promise<{ messages?: unknown[] }>;
  };

  const env = loadEnv();
  const identity = {
    botId: env.botId,
    systemPrompt: loadSystemPromptByBotId(
      env.botId,
      process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.",
    ),
  };

  const chatModel = env.ollamaApiKey
    ? createOllamaChatModelCloud(
        env.ollamaBaseUrl,
        env.ollamaChatModel,
        env.ollamaApiKey,
      )
    : createOllamaChatModel(env.ollamaBaseUrl, env.ollamaChatModel);

  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();

  const runtime = new DeepAgentRuntime(
    chatModel,
    [],
    ({ model, tools, systemPrompt, checkpointer: cp, store: st }) =>
      createDeepAgent({
        model,
        tools,
        systemPrompt,
        ...(cp ? { checkpointer: cp } : {}),
        ...(st ? { store: st } : {}),
        backend: new deepagents.FilesystemBackend({ rootDir: process.cwd() }),
        skills: env.deepAgentSkillsSources,
      }),
    () => store,
    () => checkpointer,
  );
  const app = new TerminalChatApp(identity, runtime);

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const userInput = await rl.question("> ");
      if (userInput.trim().toLowerCase() === "exit") {
        break;
      }
      const answer = await app.ask(userInput);
      output.write(`${answer}\n`);
    }
  } finally {
    rl.close();
  }
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  output.write(`${message}\n`);
  process.exit(1);
});
