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
import { createMemorySystemClient } from "./infrastructure/memory/memorySystemClient";
import { createSimplePomdpSystemClient } from "./infrastructure/simple-pomdp/simplePomdpSystemClient";

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
  const memoryClient = createMemorySystemClient({
    postgresUrl: env.postgresUrl,
    ollamaBaseUrl: env.ollamaBaseUrl,
    ollamaModel: env.ollamaChatModel,
    ...(env.ollamaApiKey ? { ollamaApiKey: env.ollamaApiKey } : {}),
  });
  const simplePomdpClient = createSimplePomdpSystemClient({
    storeDir: env.simplePomdpStoreDir,
  });
  const app = new TerminalChatApp(
    identity,
    runtime,
    async (record) => {
      await memoryClient.ingestTurnRecord(record);
      await simplePomdpClient.ingestTurnRecord(record);
    },
    async ({ botId, threadId, currentContext }) => {
      const cards = await memoryClient.queryApplicablePolicyCards({
        botId,
        threadId,
        currentContext,
        limit: 5,
      });
      if (cards.length === 0) {
        return undefined;
      }
      const base =
        "以下は経験に基づくタスク達成の抽象的な手順です。\n" +
        "完全に従う必要はありませんが、参考にしてください。\n" +
        "state: あなたの行動(反応)選択に必要な、ユーザー・会話・タスクの状況と目的\n" +
        "action: あなたの行動(反応)\n" +
        "outcome: ユーザーの行動(反応)";

      const cardText = cards
        .map(
          (card) =>
            `- state: ${card.state}\n- action: ${card.action}\n- outcome: ${card.outcome}\n`,
        )
        .join("\n\n");
      return base + cardText;
    },
  );

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
