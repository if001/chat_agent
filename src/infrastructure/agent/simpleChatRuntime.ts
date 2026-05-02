import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { AgentRequest, AgentResponse, AgentRuntime } from "../../core/types";

export class SimpleChatRuntime implements AgentRuntime {
  constructor(private readonly model: ChatOllama) {}

  async respond(request: AgentRequest): Promise<AgentResponse> {
    const messages: BaseMessage[] = [
      new SystemMessage(request.systemPrompt),
      ...request.messages.map((message) => {
        if (message.role === "assistant") {
          return new AIMessage(message.content);
        }
        return new HumanMessage(message.content);
      }),
    ];
    const result = await this.model.invoke(messages);
    return { content: stringifyContent(result.content) };
  }
}

const stringifyContent = (content: unknown): string => {
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
      .filter((item) => item.length > 0)
      .join("\n");
  }
  if (content instanceof AIMessageChunk) {
    return stringifyContent(content.content);
  }
  return "";
};
