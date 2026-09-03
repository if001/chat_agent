import { TurnRecord, TurnRecordReader } from "@chat-agent/memory-system";

export interface ConversationFocus {
  currentTopic?: string;
  currentTopicReason?: string;
  unresolvedQuestion?: string;
  unresolvedQuestionReason?: string;
  agentCommitment?: string;
  agentCommitmentReason?: string;
  resumableTopic?: string;
  resumableTopicReason?: string;
  currentTopicStatus: "active" | "complete" | "none";
  currentTopicStatusReason: string;
}

export interface ConversationAnalysis {
  focus: ConversationFocus | null;
  reason: string;
  conversationTrigger: "eligible" | "ineligible";
  conversationTriggerReason: string;
}

export interface ConversationAnalysisInput {
  botId: string;
  threadId: string;
  currentContext: string;
}

export interface ConversationAnalysisService {
  analyze(input: ConversationAnalysisInput): Promise<ConversationAnalysis>;
}

interface JsonGeneratingModel {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

interface RawConversationAnalysis {
  currentTopic?: string;
  currentTopicReason?: string;
  unresolvedQuestion?: string;
  unresolvedQuestionReason?: string;
  agentCommitment?: string;
  agentCommitmentReason?: string;
  resumableTopic?: string;
  resumableTopicReason?: string;
  currentTopicStatus?: string;
  currentTopicStatusReason?: string;
  reason?: string;
  conversationTrigger?: string;
  conversationTriggerReason?: string;
}

const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_ITEM_LIMIT = 320;
const DEFAULT_TOTAL_LIMIT = 2_400;
const FIELD_LIMIT = 240;
export const CONVERSATION_FOCUS_MAX_CHARS = 1_200;

export const createConversationAnalysisService = (options: {
  reader: TurnRecordReader;
  model: JsonGeneratingModel;
  historyLimit?: number;
  maxItemLength?: number;
  maxHistoryChars?: number;
}): ConversationAnalysisService => {
  const historyLimit = positiveInteger(options.historyLimit, DEFAULT_HISTORY_LIMIT);
  const maxItemLength = positiveInteger(options.maxItemLength, DEFAULT_ITEM_LIMIT);
  const maxHistoryChars = positiveInteger(options.maxHistoryChars, DEFAULT_TOTAL_LIMIT);
  return {
    async analyze(input) {
      const currentInput = normalizeInput(input.currentContext);
      if (!currentInput) {
        return ineligibleAnalysis("current input is empty");
      }
      const records = await options.reader.listRecentTurnRecords({
        botId: input.botId,
        threadId: input.threadId,
        limit: historyLimit,
      });
      const history = formatHumanHistory(
        records,
        historyLimit,
        maxItemLength,
        maxHistoryChars,
      );
      if (history.length === 0) {
        return {
          focus: {
            currentTopic: truncate(currentInput),
            currentTopicReason: "the first request establishes this topic",
            currentTopicStatus: "active",
            currentTopicStatusReason: "the first request is still active",
          },
          reason: "no prior human conversation history",
          conversationTrigger: "ineligible",
          conversationTriggerReason:
            "the first request establishes an active topic",
        };
      }
      let parsed: RawConversationAnalysis;
      try {
        parsed = await options.model.generateJson<RawConversationAnalysis>(
          [
            "You analyze the current focus of a human-agent conversation.",
            "Infer meaning rather than relying on punctuation or fixed keywords.",
            "Distinguish the current topic from a different topic that can be resumed later.",
            "Recognize unanswered questions, implicit agent commitments, completion, topic changes, and returns to earlier topics.",
            "Also decide whether exactly one additional proactive topic can be integrated naturally into the normal reply.",
            "conversationTrigger must be eligible or ineligible. Use ineligible for active focus, acknowledgement, correction, error reporting, or work still in progress. Do not reject a technical question merely because it discusses errors or corrections.",
            "currentTopicStatus must be active, complete, or none.",
            "For each focus value, return its short natural-language reason in the corresponding currentTopicReason, unresolvedQuestionReason, agentCommitmentReason, resumableTopicReason, or currentTopicStatusReason field.",
            "Do not return a focus value without its reason or a reason without its value. currentTopicStatus and currentTopicStatusReason are required.",
            "Return JSON with the focus fields, a short overall reason, conversationTrigger, and a short conversationTriggerReason.",
          ].join(" "),
          JSON.stringify({
            humanConversationHistory: history,
            currentInput: truncate(currentInput, maxItemLength),
          }),
        );
      } catch {
        return ineligibleAnalysis("conversation analysis failed");
      }
      return normalizeAnalysis(parsed);
    },
  };
};

export const formatConversationFocus = (
  focus: ConversationFocus | null,
): string | undefined => {
  if (!focus || focus.currentTopicStatus === "none") {
    return undefined;
  }
  const lines = [
    `status: ${focus.currentTopicStatus}`,
    `statusReason: ${focus.currentTopicStatusReason}`,
    ...(focus.currentTopic
      ? [
          `currentTopic: ${focus.currentTopic}`,
          `currentTopicReason: ${focus.currentTopicReason}`,
        ]
      : []),
    ...(focus.unresolvedQuestion
      ? [
          `unresolvedQuestion: ${focus.unresolvedQuestion}`,
          `unresolvedQuestionReason: ${focus.unresolvedQuestionReason}`,
        ]
      : []),
    ...(focus.agentCommitment
      ? [
          `agentCommitment: ${focus.agentCommitment}`,
          `agentCommitmentReason: ${focus.agentCommitmentReason}`,
        ]
      : []),
    ...(focus.resumableTopic
      ? [
          `resumableTopic: ${focus.resumableTopic}`,
          `resumableTopicReason: ${focus.resumableTopicReason}`,
        ]
      : []),
  ];
  return truncate(lines.join("\n"), CONVERSATION_FOCUS_MAX_CHARS);
};

const formatHumanHistory = (
  records: TurnRecord[],
  historyLimit: number,
  maxItemLength: number,
  maxHistoryChars: number,
): string[] => {
  const items = records
    .slice(-historyLimit)
    .filter((record) => record.kind === "human")
    .flatMap((record) =>
      record.messages
        .filter(
          (message) =>
            message.role === "user" || message.role === "assistant",
        )
        .map((message) =>
          truncate(
            `[${message.role}] ${normalizeInput(message.content)}`,
            maxItemLength,
          ),
        ),
    )
    .filter((item) => !/^\[(?:user|assistant)\]\s*$/u.test(item));
  const selected: string[] = [];
  let remaining = maxHistoryChars;
  for (const item of items.reverse()) {
    if (remaining <= 0) {
      break;
    }
    const bounded = truncate(item, remaining);
    selected.push(bounded);
    remaining -= bounded.length;
  }
  return selected.reverse();
};

const normalizeAnalysis = (
  value: RawConversationAnalysis | null | undefined,
): ConversationAnalysis => {
  const status = value?.currentTopicStatus;
  const statusReason = value?.currentTopicStatusReason?.trim();
  const reason = value?.reason?.trim();
  const conversationTrigger = value?.conversationTrigger;
  const conversationTriggerReason = value?.conversationTriggerReason?.trim();
  if (
    !reason ||
    !statusReason ||
    !conversationTriggerReason ||
    (conversationTrigger !== "eligible" &&
      conversationTrigger !== "ineligible") ||
    (status !== "active" && status !== "complete" && status !== "none")
  ) {
    return ineligibleAnalysis("invalid conversation analysis output");
  }
  const focus: ConversationFocus = {
    ...optionalFocusField(
      "currentTopic",
      "currentTopicReason",
      value?.currentTopic,
      value?.currentTopicReason,
    ),
    ...optionalFocusField(
      "unresolvedQuestion",
      "unresolvedQuestionReason",
      value?.unresolvedQuestion,
      value?.unresolvedQuestionReason,
    ),
    ...optionalFocusField(
      "agentCommitment",
      "agentCommitmentReason",
      value?.agentCommitment,
      value?.agentCommitmentReason,
    ),
    ...optionalFocusField(
      "resumableTopic",
      "resumableTopicReason",
      value?.resumableTopic,
      value?.resumableTopicReason,
    ),
    currentTopicStatus: status,
    currentTopicStatusReason: truncate(statusReason),
  };
  return {
    focus,
    reason: truncate(reason),
    conversationTrigger,
    conversationTriggerReason: truncate(conversationTriggerReason),
  };
};

const ineligibleAnalysis = (reason: string): ConversationAnalysis => ({
  focus: null,
  reason,
  conversationTrigger: "ineligible",
  conversationTriggerReason: reason,
});

const optionalFocusField = (
  valueKey: "currentTopic" | "unresolvedQuestion" | "agentCommitment" | "resumableTopic",
  reasonKey:
    | "currentTopicReason"
    | "unresolvedQuestionReason"
    | "agentCommitmentReason"
    | "resumableTopicReason",
  value: string | undefined,
  reason: string | undefined,
): Partial<ConversationFocus> => {
  const normalizedValue = value?.trim();
  const normalizedReason = reason?.trim();
  return normalizedValue && normalizedReason
    ? {
        [valueKey]: truncate(normalizedValue),
        [reasonKey]: truncate(normalizedReason),
      }
    : {};
};

const normalizeInput = (content: string): string =>
  content
    .replace(/^Current time: .*?\n\n/isu, "")
    .replace(/(?:^|\n\n)(?:User message|Additional user message):\n/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const truncate = (value: string, limit: number = FIELD_LIMIT): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

const positiveInteger = (value: number | undefined, fallback: number): number =>
  Math.max(1, Math.floor(value ?? fallback));
