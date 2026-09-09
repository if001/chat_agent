import {
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  ToolMessage,
  getBufferString,
} from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

const SUMMARY_SOURCE = "interaction_summarization";
const REMOVE_ALL_MESSAGES = "__remove_all__";
const AGENT_MIDDLEWARE_BRAND = Symbol.for("AgentMiddleware");

export interface CheckpointSummarizationOptions {
  model: {
    invoke(input: string): Promise<{ content: unknown }>;
  };
  contextWindowTokens: number;
  triggerFraction: number;
  recentInteractions: number;
  toolResultMaxChars: number;
  tokenCounter?: (messages: BaseMessage[]) => number | Promise<number>;
}

export const checkpointSummarizationTriggerTokens = (
  contextWindowTokens: number,
  triggerFraction: number,
): number => Math.floor(contextWindowTokens * triggerFraction);

export const findInteractionCutoff = (
  messages: BaseMessage[],
  recentInteractions: number,
): number => {
  const humanIndices = messages.flatMap((message, index) =>
    HumanMessage.isInstance(message) &&
    message.additional_kwargs.lc_source !== SUMMARY_SOURCE
      ? [index]
      : [],
  );
  if (humanIndices.length <= recentInteractions) {
    return 0;
  }
  let cutoff = humanIndices[humanIndices.length - recentInteractions] ?? 0;
  while (cutoff > 0 && SystemMessage.isInstance(messages[cutoff - 1])) {
    cutoff -= 1;
  }
  return cutoff;
};

export const compactToolMessage = (
  message: ToolMessage,
  maxChars: number,
): ToolMessage => {
  const content = stringifyContent(message.content);
  if (content.length <= maxChars) {
    return message;
  }
  const suffix = `\n...[tool result shortened; original ${content.length} chars]`;
  const shortened =
    suffix.length >= maxChars
      ? suffix.slice(0, maxChars)
      : `${content.slice(0, maxChars - suffix.length)}${suffix}`;
  return new ToolMessage({
    ...message,
    content: shortened,
  });
};

export const createCheckpointSummarizationMiddleware = (
  options: CheckpointSummarizationOptions,
) => {
  const triggerTokens = checkpointSummarizationTriggerTokens(
    options.contextWindowTokens,
    options.triggerFraction,
  );
  const countTokens = options.tokenCounter ?? countTokensApproximately;

  return {
    [AGENT_MIDDLEWARE_BRAND]: true,
    name: "InteractionSummarizationMiddleware",
    beforeModel: async (state: { messages: BaseMessage[] }) => {
      const messages = state.messages as BaseMessage[];
      const compacted = messages.map((message) =>
        ToolMessage.isInstance(message)
          ? compactToolMessage(message, options.toolResultMaxChars)
          : message,
      );
      const toolUpdates = compacted.filter(
        (message, index) => message !== messages[index],
      );

      if ((await countTokens(compacted)) < triggerTokens) {
        return toolUpdates.length > 0 ? { messages: toolUpdates } : undefined;
      }

      const cutoff = findInteractionCutoff(
        compacted,
        options.recentInteractions,
      );
      if (cutoff <= 0) {
        return toolUpdates.length > 0 ? { messages: toolUpdates } : undefined;
      }

      const summary = await options.model.invoke(
        buildSummaryPrompt(compacted.slice(0, cutoff)),
      );
      const summaryMessage = new HumanMessage({
        id: randomUUID(),
        content: `Here is a summary of earlier interactions:\n\n${stringifyContent(summary.content)}`,
        additional_kwargs: { lc_source: SUMMARY_SOURCE },
      });

      return {
        messages: [
          new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
          summaryMessage,
          ...compacted.slice(cutoff),
        ],
      };
    },
  };
};

const buildSummaryPrompt = (messages: BaseMessage[]): string =>
  [
    "Summarize the earlier conversation for checkpoint continuation.",
    "Preserve user facts, decisions, unresolved work, and completed tool actions.",
    "Do not invent information. Return only the concise summary.",
    "",
    getBufferString(messages),
  ].join("\n");

const stringifyContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item
          ? String(item.text)
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return String(content);
};

const countTokensApproximately = (messages: BaseMessage[]): number =>
  messages.reduce(
    (total, message) => total + Math.ceil(stringifyContent(message.content).length / 4) + 3,
    0,
  );
