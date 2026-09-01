import { TurnRecord, TurnRecordReader } from "@chat-agent/memory-system";

export interface ConversationFocus {
  currentTopic?: string;
  unresolvedQuestion?: string;
  agentCommitment?: string;
  resumableTopic?: string;
  currentTopicStatus: "active" | "complete" | "none";
}

export interface ConversationFocusInput {
  botId: string;
  threadId: string;
  currentContext?: string;
}

export interface ConversationFocusSource {
  load(input: ConversationFocusInput): Promise<ConversationFocus | null>;
}

const HISTORY_LIMIT = 12;
const FIELD_LIMIT = 240;
export const CONVERSATION_FOCUS_MAX_CHARS = 1_200;

export const createConversationFocusSource = (
  reader: TurnRecordReader,
): ConversationFocusSource => ({
  load: async (input) => {
    const records = (
      await reader.listRecentTurnRecords({
        botId: input.botId,
        threadId: input.threadId,
        limit: HISTORY_LIMIT,
      })
    )
      .slice(-HISTORY_LIMIT)
      .filter((record) => record.kind === "human");
    return deriveConversationFocus(records, input.currentContext);
  },
});

export const deriveConversationFocus = (
  records: TurnRecord[],
  currentContext?: string,
): ConversationFocus | null => {
  const messages = records.flatMap((record) =>
    record.kind === "human"
      ? record.messages
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: normalizeContent(message.content),
          }))
      : [],
  );
  const currentInput = currentContext
    ? normalizeContent(currentContext)
    : undefined;
  if (currentInput) {
    messages.push({ role: "user", content: currentInput });
  }
  if (messages.length === 0) {
    return null;
  }

  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .filter((content) => content.length > 0);
  const substantive = userMessages.filter(
    (content) => !isShortConfirmation(content) && !isExplicitCompletion(content),
  );
  const { currentTopic, resumableTopic } = resolveTopics(
    substantive,
    currentInput,
  );
  const unresolvedQuestion = resolveUnansweredQuestion(messages);
  const agentCommitment = resolveAgentCommitment(messages);
  const latestUser = userMessages.at(-1);
  const explicitlyComplete = latestUser
    ? isExplicitCompletion(latestUser)
    : false;
  const status: ConversationFocus["currentTopicStatus"] = explicitlyComplete
    ? "complete"
    : unresolvedQuestion || agentCommitment || (currentInput && !isShortConfirmation(currentInput))
      ? "active"
      : currentTopic
        ? "complete"
        : "none";

  const focus: ConversationFocus = {
    ...(explicitlyComplete || !currentTopic
      ? {}
      : { currentTopic: truncate(currentTopic) }),
    ...(!explicitlyComplete && unresolvedQuestion
      ? { unresolvedQuestion: truncate(unresolvedQuestion) }
      : {}),
    ...(!explicitlyComplete && agentCommitment
      ? { agentCommitment: truncate(agentCommitment) }
      : {}),
    ...(!explicitlyComplete && resumableTopic
      ? { resumableTopic: truncate(resumableTopic) }
      : {}),
    currentTopicStatus: status,
  };
  return focus;
};

export const formatConversationFocus = (
  focus: ConversationFocus | null,
): string | undefined => {
  if (!focus || focus.currentTopicStatus === "none") {
    return undefined;
  }
  const lines = [
    `status: ${focus.currentTopicStatus}`,
    ...(focus.currentTopic ? [`currentTopic: ${focus.currentTopic}`] : []),
    ...(focus.unresolvedQuestion
      ? [`unresolvedQuestion: ${focus.unresolvedQuestion}`]
      : []),
    ...(focus.agentCommitment
      ? [`agentCommitment: ${focus.agentCommitment}`]
      : []),
    ...(focus.resumableTopic
      ? [`resumableTopic: ${focus.resumableTopic}`]
      : []),
  ];
  return truncate(lines.join("\n"), CONVERSATION_FOCUS_MAX_CHARS);
};

const resolveTopics = (
  substantive: string[],
  currentInput?: string,
): { currentTopic?: string; resumableTopic?: string } => {
  if (substantive.length === 0) {
    return {};
  }
  let transitionIndex = -1;
  for (let index = substantive.length - 1; index >= 0; index -= 1) {
    const topic = substantive[index];
    if (topic && isTopicTransition(topic)) {
      transitionIndex = index;
      break;
    }
  }
  const topicBeforeTransition =
    transitionIndex > 0 ? substantive[transitionIndex - 1] : undefined;
  const latest = substantive.at(-1);
  if (currentInput && isReturnToPreviousTopic(currentInput)) {
    return {
      ...(topicBeforeTransition ? { currentTopic: topicBeforeTransition } : {}),
      ...(latest && latest !== topicBeforeTransition
        ? { resumableTopic: latest }
        : {}),
    };
  }
  return {
    ...(latest ? { currentTopic: latest } : {}),
    ...(topicBeforeTransition && topicBeforeTransition !== latest
      ? { resumableTopic: topicBeforeTransition }
      : {}),
  };
};

const resolveUnansweredQuestion = (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isQuestion(message.content)) {
      continue;
    }
    const later = messages.slice(index + 1);
    if (message.role === "assistant") {
      const answered = later.some(
        (candidate) =>
          candidate.role === "user" &&
          !isShortConfirmation(candidate.content),
      );
      if (!answered) {
        return message.content;
      }
      continue;
    }
    const assistantReply = later.find(
      (candidate) => candidate.role === "assistant",
    );
    if (
      !assistantReply ||
      isCommitment(assistantReply.content) ||
      isQuestion(assistantReply.content)
    ) {
      return message.content;
    }
  }
  return undefined;
};

const resolveAgentCommitment = (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string | undefined => {
  let commitment: string | undefined;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    if (isCommitmentCompletion(message.content)) {
      commitment = undefined;
    }
    if (isCommitment(message.content)) {
      commitment = message.content;
    }
  }
  return commitment;
};

const normalizeContent = (content: string): string =>
  content
    .replace(/^Current time: .*?\n\n/isu, "")
    .replace(/(?:^|\n\n)(?:User message|Additional user message):\n/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const isQuestion = (content: string): boolean => /[?？]/u.test(content);
const isShortConfirmation = (content: string): boolean =>
  /^(?:ok(?:ay)?|了解|はい|うん|ありがとう(?:ございます)?|thanks|thx|なるほど)[.!。！]*$/iu.test(
    content.trim(),
  );
const isExplicitCompletion = (content: string): boolean =>
  /(?:解決(?:した|しました|済み)|完了(?:した|しました)?|もう大丈夫|この件は終わり|対応不要|close this|resolved|all done)/iu.test(
    content,
  );
const isTopicTransition = (content: string): boolean =>
  /(?:ところで|話(?:は|を)変え|別件|別の話|一旦|その前に|先に)/u.test(content);
const isReturnToPreviousTopic = (content: string): boolean =>
  /(?:元|前|さっき|先ほど).*(?:話|件).*(?:戻|続)|(?:話|件).*(?:戻|続)/u.test(
    content,
  );
const isCommitment = (content: string): boolean =>
  /(?:(?:後で|次に|これから).*(?:確認|調査|対応|修正|共有)|(?:確認|調査|対応|修正|共有)(?:して)?(?:おきます|します|いたします))/u.test(
    content,
  );
const isCommitmentCompletion = (content: string): boolean =>
  /(?:確認|調査|対応|修正|共有).*(?:しました|済み|完了|できました)|(?:完了|解決)(?:しました|済み)?/u.test(
    content,
  );

const truncate = (value: string, limit: number = FIELD_LIMIT): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
