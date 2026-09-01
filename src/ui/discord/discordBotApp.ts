import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";
import {
  createInMemoryQueueApi,
  MentionQueueTask,
  QueueApi,
  QueueTask,
} from "@chat-agent/queue";
import { handleMention } from "../../core/usecases/handleMention";
import { QueueWorker } from "../../queue/queueWorker";
import { formatAgentUserInput } from "../agentUserInput";
import { TurnRecordInput } from "../../infrastructure/memory/memorySystemClient";

export interface ConversationTopicPlan {
  text: string;
  sourceInteractionId: string;
}

export interface DiscordTransport {
  onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
  sendMessage(channelId: string, content: string): Promise<void>;
  sendTyping(channelId: string): Promise<void>;
}

export class DiscordBotApp {
  private readonly queueApi: QueueApi;
  private readonly worker: QueueWorker;
  private readonly pendingInteractionByThread = new Map<string, string>();

  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly transport: DiscordTransport,
    private readonly mentionChannelId: string,
    queueOrDiscordBotUserId?: QueueApi | string,
    discordBotUserIdOrQueue?: string | QueueApi,
    private readonly onTurnRecorded?: (
      record: TurnRecordInput,
    ) => Promise<void>,
    private readonly resolveRequestContext?: (input: {
      botId: string;
      userId: string;
      threadId: string;
      currentContext: string;
      kind: "human" | "conversation" | "proactive" | "delegation";
      proactiveEvidence?: string;
    }) => Promise<string | undefined>,
    private readonly resolveConversationTopic?: (input: {
      botId: string;
      threadId: string;
      userId: string;
    }) => Promise<ConversationTopicPlan | null>,
  ) {
    const queueApi = resolveQueueApi(
      queueOrDiscordBotUserId,
      discordBotUserIdOrQueue,
    );
    this.discordBotUserId = resolveDiscordBotUserId(
      queueOrDiscordBotUserId,
      discordBotUserIdOrQueue,
    );
    this.queueApi = queueApi ?? createInlineQueueApi();
    this.worker = new QueueWorker(
      this.queueApi,
      (task) => this.processTask(task),
      1_000,
    );
  }

  private readonly discordBotUserId: string | undefined;

  start(): void {
    this.worker.start();
    this.transport.onMessage(async (message) => {
      this.logInfo(
        `received channel=${message.channelId} author=${message.authorId} mentionsBot=${message.mentionsBot}`,
      );
      if (message.channelId === this.mentionChannelId) {
        await this.enqueueUserTask(message.content, message);
        return;
      }
      this.logInfo(
        `ignored channel=${message.channelId} reason=channel_mismatch`,
      );
    });
  }

  private async enqueueUserTask(
    text: string,
    message: ChannelMessage,
  ): Promise<void> {
    const sanitizedText = sanitizeDiscordInput(text, this.discordBotUserId);
    const formattedText = formatAgentUserInput(sanitizedText);
    const task = await this.queueApi.enqueueMention({
      botId: this.identity.botId,
      userId: message.authorId,
      channelId: message.channelId,
      text: formattedText,
      mentionsBot: message.mentionsBot,
      dueAt: new Date(),
    });
    this.logInfo(
      `queued id=${task.id} action=${task.action} mentionsBot=${task.mentionsBot}`,
    );
    await this.worker.tick(new Date());
  }

  private async processTask(task: QueueTask): Promise<void> {
    this.logInfo(`processing id=${task.id} action=${task.action}`);
    if (task.action === "mention") {
      if (!task.mentionsBot) {
        this.logInfo(`ignored id=${task.id} reason=not_mentioned`);
        return;
      }
      this.sendTypingBestEffort(task.channelId);
      const conversationTopic = await this.planConversationTopic(task);
      const requestContext = await this.buildRequestContext(
        task.userId,
        task.targetThreadId,
        task.text,
        conversationTopic ? "conversation" : "human",
        conversationTopic?.text,
      );
      const mentionReply = await handleMention(
        this.identity,
        this.runtime,
        {
          channelId: task.channelId,
          authorId: task.userId,
          content: task.text,
          mentionsBot: task.mentionsBot,
        },
        requestContext,
      );
      if (mentionReply) {
        await this.transport.sendMessage(task.channelId, mentionReply);
        await this.recordTurn(
          task,
          mentionReply,
          conversationTopic?.sourceInteractionId,
        );
        this.logInfo(`replied id=${task.id} action=mention`);
      } else {
        this.logError(`no_reply id=${task.id} action=mention`);
      }
      return;
    }

    if (task.action === "agent_input") {
      this.sendTypingBestEffort(task.channelId);
      const threadId = task.targetThreadId;
      const requestContext = await this.buildRequestContext(
        task.userId,
        threadId,
        task.text,
        "proactive",
        task.text,
      );
      const result = await this.runtime.respond({
        botId: this.identity.botId,
        userId: task.userId,
        systemPrompt: this.identity.systemPrompt,
        ...(requestContext ? { requestContext } : {}),
        threadId,
        messages: [{ role: "user", content: task.text }],
      });
      if (result.content.length > 0) {
        await this.transport.sendMessage(task.channelId, result.content);
        await this.recordTurn(task, result.content);
        this.logInfo(`replied id=${task.id} action=agent_input`);
      } else {
        this.logError(`no_reply id=${task.id} action=agent_input`);
      }
    }
  }

  private sendTypingBestEffort(channelId: string): void {
    void this.transport.sendTyping(channelId).catch((error: unknown) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(`[discord-typing-error] ${message}\n`);
    });
  }

  private logInfo(message: string): void {
    process.stdout.write(`[discord-bot] ${message}\n`);
  }

  private logError(message: string): void {
    process.stdout.write(`[discord-bot-error] ${message}\n`);
  }

  private async recordTurn(
    task: QueueTask,
    assistantContent: string,
    conversationInteractionId?: string,
  ): Promise<void> {
    if (!this.onTurnRecorded) {
      return;
    }
    const timestamp = new Date().toISOString();
    const sourceInteractionId =
      task.source === "user"
        ? (conversationInteractionId ??
          task.sourceInteractionId ??
          this.pendingInteractionByThread.get(task.targetThreadId))
        : task.sourceInteractionId;
    try {
      await this.onTurnRecorded({
        botId: this.identity.botId,
        threadId: task.targetThreadId,
        kind: task.source === "user" ? "human" : "proactive",
        ...(sourceInteractionId
          ? { sourceInteractionId }
          : {}),
        messages: [
          { role: "user", content: task.text, timestampIso: timestamp },
          {
            role: "assistant",
            content: assistantContent,
            timestampIso: timestamp,
          },
        ],
        createdAtIso: timestamp,
      });
      if (task.source === "user") {
        if (conversationInteractionId) {
          this.pendingInteractionByThread.set(
            task.targetThreadId,
            conversationInteractionId,
          );
        } else {
          this.pendingInteractionByThread.delete(task.targetThreadId);
        }
      } else if (sourceInteractionId) {
        this.pendingInteractionByThread.set(
          task.targetThreadId,
          sourceInteractionId,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(`[memory-system-error] ${message}\n`);
    }
  }

  private async planConversationTopic(
    task: MentionQueueTask,
  ): Promise<ConversationTopicPlan | null> {
    if (
      !this.resolveConversationTopic ||
      this.pendingInteractionByThread.has(task.targetThreadId) ||
      !isConversationTopicEligible(extractUserMessage(task.text))
    ) {
      return null;
    }
    try {
      return await this.resolveConversationTopic({
        botId: this.identity.botId,
        threadId: task.targetThreadId,
        userId: task.authorId,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(
        `[simple-pomdp-error] conversation trigger failed: ${message}\n`,
      );
      return null;
    }
  }

  private async buildRequestContext(
    userId: string,
    threadId: string,
    currentContext: string,
    kind: "human" | "conversation" | "proactive" | "delegation",
    proactiveEvidence?: string,
  ): Promise<string | undefined> {
    if (!this.resolveRequestContext) {
      return proactiveEvidence
        ? `# Conversation Topic Integration\n${proactiveEvidence}`
        : undefined;
    }
    try {
      return await this.resolveRequestContext({
        botId: this.identity.botId,
        userId,
        threadId,
        currentContext,
        kind,
        ...(proactiveEvidence ? { proactiveEvidence } : {}),
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(
        `[request-context-error] context build failed: ${message}\n`,
      );
      return undefined;
    }
  }
}

const sanitizeDiscordInput = (
  text: string,
  discordBotUserId?: string,
): string => {
  if (!discordBotUserId) {
    return text;
  }
  const mentionPattern = new RegExp(
    `^<@!?${escapeRegExp(discordBotUserId)}>\\s*`,
  );
  return text.replace(mentionPattern, "").trim();
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractUserMessage = (input: string): string =>
  input.split("\n\nUser message:\n").at(-1)?.trim() ?? input.trim();

export const isConversationTopicEligible = (input: string): boolean => {
  const text = input.trim();
  if (text.length === 0) {
    return false;
  }
  if (
    /^(?:ok(?:ay)?|了解|はい|うん|ありがとう(?:ございます)?|thanks|thx|なるほど)[.!。！]*$/iu.test(
      text,
    )
  ) {
    return false;
  }
  return !/(?:エラー|失敗|違う|訂正|修正中|処理中|待って|error|failed|correction|actually)/iu.test(
    text,
  );
};

const resolveQueueApi = (
  first?: QueueApi | string,
  second?: QueueApi | string,
): QueueApi | undefined => {
  if (typeof first === "object") {
    return first;
  }
  if (typeof second === "object") {
    return second;
  }
  return undefined;
};

const resolveDiscordBotUserId = (
  first?: QueueApi | string,
  second?: QueueApi | string,
): string | undefined => {
  if (typeof first === "string") {
    return first;
  }
  if (typeof second === "string") {
    return second;
  }
  return undefined;
};

const createInlineQueueApi = (): QueueApi => createInMemoryQueueApi();
