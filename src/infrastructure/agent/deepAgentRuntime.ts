import { AgentRequest, AgentResponse, AgentRuntime } from "../../core/types";
import {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";

interface DeepAgentInvoker {
  invoke(input: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ messages?: unknown[] }>;
  invoke(
    input: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: string;
      }>;
    },
    config: { configurable: { thread_id: string } },
  ): Promise<{ messages?: unknown[] }>;
}

type DeepAgentFactory = (config: {
  model: unknown;
  systemPrompt: string;
  tools: unknown[];
  checkpointer?: BaseCheckpointSaver | boolean;
  store?: BaseStore;
}) => DeepAgentInvoker;

export class DeepAgentRuntime implements AgentRuntime {
  private readonly agentCache = new Map<string, DeepAgentInvoker>();

  constructor(
    private readonly model: unknown,
    private readonly tools: unknown[],
    private readonly createDeepAgent: DeepAgentFactory,
    private readonly getStoreByBotId: (botId: string) => BaseStore | undefined,
    private readonly getCheckpointByBotId: (
      botId: string,
    ) => BaseCheckpointSaver | undefined,
  ) {}

  async respond(request: AgentRequest): Promise<AgentResponse> {
    const agent = this.getOrCreateAgent(request.botId, request.systemPrompt);
    const threadKey = `${request.botId}:${request.threadId ?? request.botId}`;
    const result = await agent.invoke(
      { messages: request.messages },
      { configurable: { thread_id: threadKey } },
    );
    const assistantMessage = extractLastAssistantMessage(result.messages ?? []);
    return { content: assistantMessage?.content ?? "" };
  }

  private getOrCreateAgent(
    botId: string,
    systemPrompt: string,
  ): DeepAgentInvoker {
    const cached = this.agentCache.get(botId);
    if (cached) {
      return cached;
    }
    const checkpointer = this.getCheckpointByBotId(botId);
    const store = this.getStoreByBotId(botId);
    const agent = this.createDeepAgent({
      model: this.model,
      systemPrompt,
      tools: this.tools,
      ...(checkpointer ? { checkpointer } : {}),
      ...(store ? { store } : {}),
    });
    this.agentCache.set(botId, agent);
    return agent;
  }
}

const stringifyMessageContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null && "text" in item) {
          const value = (item as { text?: unknown }).text;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .filter((v) => v.length > 0)
      .join("\n");
  }
  return "";
};

const extractLastAssistantMessage = (
  messages: unknown[],
): { role: "assistant"; content: string } | null => {
  const reversed = [...messages].reverse();
  for (const message of reversed) {
    if (typeof message !== "object" || message === null) {
      continue;
    }

    const role = getRoleFromMessage(message);
    if (role !== "assistant") {
      continue;
    }

    const content = stringifyMessageContent(
      (message as { content?: unknown }).content,
    );
    return { role: "assistant", content };
  }
  return null;
};

const getRoleFromMessage = (
  message: unknown,
): "assistant" | "user" | "system" | null => {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const role = (message as { role?: unknown }).role;
  if (role === "assistant" || role === "user" || role === "system") {
    return role;
  }
  const getType = (message as { _getType?: unknown })._getType;
  const type =
    typeof getType === "function"
      ? getType.call(message)
      : (message as { type?: unknown }).type;
  if (type === "ai") {
    return "assistant";
  }
  if (type === "human") {
    return "user";
  }
  if (type === "system") {
    return "system";
  }
  return null;
};
