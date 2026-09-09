import { QueueTask } from "@chat-agent/queue";
import {
  AgentRuntime,
  BotIdentity,
  ChatMessage,
} from "./types";

export type ResponseInputOrigin = "human" | "proactive" | "delegation";

export interface ResponseInputEnvelope {
  botId: string;
  userId: string;
  threadId: string;
  channelId: string;
  content: string;
  origin: ResponseInputOrigin;
  sourceInteractionId?: string;
}

export interface ResponseInputTurnRecord {
  botId: string;
  threadId: string;
  kind: ResponseInputOrigin;
  sourceInteractionId?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestampIso: string;
  }>;
  createdAtIso: string;
}

export const createResponseInputEnvelope = (
  input: ResponseInputEnvelope,
): ResponseInputEnvelope => input;

export const responseInputEnvelopeFromQueueTask = (
  botId: string,
  task: QueueTask,
  sourceInteractionId?: string | null,
): ResponseInputEnvelope => {
  const resolvedInteractionId =
    sourceInteractionId === undefined
      ? task.sourceInteractionId
      : sourceInteractionId;
  return {
    botId,
    userId: task.userId,
    threadId: task.targetThreadId,
    channelId: task.channelId,
    content: task.text,
    origin: task.source === "user" ? "human" : "proactive",
    ...(resolvedInteractionId
      ? { sourceInteractionId: resolvedInteractionId }
      : {}),
  };
};

export const responseInputCheckpointMessage = (
  envelope: ResponseInputEnvelope,
): ChatMessage => ({
  role: "user",
  content: envelope.content,
  additional_kwargs: {
    response_input_origin: envelope.origin,
    ...(envelope.sourceInteractionId
      ? { source_interaction_id: envelope.sourceInteractionId }
      : {}),
  },
});

export const responseInputTurnRecord = (
  envelope: ResponseInputEnvelope,
  assistantContent: string,
  timestampIso: string,
): ResponseInputTurnRecord => ({
  botId: envelope.botId,
  threadId: envelope.threadId,
  kind: envelope.origin,
  ...(envelope.sourceInteractionId
    ? { sourceInteractionId: envelope.sourceInteractionId }
    : {}),
  messages: [
    {
      role: "user",
      content: envelope.content,
      timestampIso,
    },
    {
      role: "assistant",
      content: assistantContent,
      timestampIso,
    },
  ],
  createdAtIso: timestampIso,
});

export const runResponseInput = async (
  identity: BotIdentity,
  runtime: AgentRuntime,
  envelope: ResponseInputEnvelope,
  requestContext?: string,
): Promise<string> => {
  const response = await runtime.respond({
    botId: envelope.botId,
    userId: envelope.userId,
    systemPrompt: identity.systemPrompt,
    ...(requestContext ? { requestContext } : {}),
    threadId: envelope.threadId,
    messages: [responseInputCheckpointMessage(envelope)],
  });
  return response.content;
};
