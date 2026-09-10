import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";
import {
  createInMemoryQueueApi,
  MentionQueueTask,
  QueueApi,
  QueueTask,
} from "@chat-agent/queue";
import { QueueWorker } from "../../queue/queueWorker";
import { formatAgentUserInput } from "../agentUserInput";
import { TurnRecordInput } from "../../infrastructure/memory/memorySystemClient";
import type { ConversationOpportunityAssessment } from "@chat-agent/simple-pomdp-system";
import {
  ResponseInputEnvelope,
  responseInputEnvelopeFromQueueTask,
  responseInputTurnRecord,
  runResponseInput,
} from "../../core/responseInputEnvelope";

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
    private readonly resolveConversationOpportunity?: (input: {
      botId: string;
      threadId: string;
      userId: string;
      currentContext: string;
    }) => Promise<ConversationOpportunityAssessment>,
    private readonly resolvePendingInteraction?: (input: {
      botId: string;
      threadId: string;
      userId: string;
    }) => Promise<string | null>,
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
      const pendingInteractionId = await this.findPendingInteraction(task);
      const conversationTopic = await this.planConversationTopic(
        task,
        pendingInteractionId,
      );
      const requestContext = await this.buildRequestContext(
        task.userId,
        task.targetThreadId,
        task.text,
        conversationTopic ? "conversation" : "human",
        conversationTopic?.text,
      );
      const envelope = responseInputEnvelopeFromQueueTask(
        this.identity.botId,
        task,
        conversationTopic?.sourceInteractionId ??
          task.sourceInteractionId ??
          pendingInteractionId,
      );
      await this.executeResponse(task, envelope, requestContext);
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
      const envelope = responseInputEnvelopeFromQueueTask(
        this.identity.botId,
        task,
        task.sourceInteractionId,
      );
      await this.executeResponse(task, envelope, requestContext);
    }
  }

  private async executeResponse(
    task: QueueTask,
    envelope: ResponseInputEnvelope,
    requestContext?: string,
  ): Promise<void> {
    this.logQueueDebug(
      `runtime_start taskId=${task.id} interactionId=${task.sourceInteractionId ?? "none"} action=${task.action}`,
    );
    const content = await runResponseInput(
      this.identity,
      this.runtime,
      envelope,
      requestContext,
    );
    this.logQueueDebug(
      `runtime_complete taskId=${task.id} contentLength=${content.length}`,
    );
    if (content.length === 0) {
      this.logError(`no_reply id=${task.id} action=${task.action}`);
      return;
    }
    const latestConversationVersion =
      await this.queueApi.getLatestConversationVersion(task.targetThreadId);
    this.logQueueDebug(
      `version_check taskId=${task.id} taskVersion=${task.conversationVersion} latestVersion=${latestConversationVersion}`,
    );
    if (task.conversationVersion !== latestConversationVersion) {
      this.logInfo(
        `discarded id=${task.id} reason=stale conversationVersion=${task.conversationVersion}`,
      );
      return;
    }
    this.logQueueDebug(
      `send_start taskId=${task.id} channelId=${envelope.channelId}`,
    );
    await this.transport.sendMessage(envelope.channelId, content);
    this.logQueueDebug(
      `send_complete taskId=${task.id} channelId=${envelope.channelId}`,
    );
    await this.recordTurn(envelope, content);
    this.logInfo(`replied id=${task.id} action=${task.action}`);
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

  private logQueueDebug(message: string): void {
    process.stdout.write(`[DEBUG-pomdp-queue] ${message}\n`);
  }

  private async recordTurn(
    envelope: ResponseInputEnvelope,
    assistantContent: string,
  ): Promise<void> {
    if (!this.onTurnRecorded) {
      return;
    }
    const timestamp = new Date().toISOString();
    try {
      await this.onTurnRecorded(
        responseInputTurnRecord(envelope, assistantContent, timestamp),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(`[memory-system-error] ${message}\n`);
    }
  }

  private async planConversationTopic(
    task: MentionQueueTask,
    pendingInteractionId: string | null,
  ): Promise<ConversationTopicPlan | null> {
    if (
      !this.resolveConversationTopic ||
      !this.resolveConversationOpportunity ||
      pendingInteractionId !== null
    ) {
      return null;
    }
    try {
      const opportunity = await this.resolveConversationOpportunity({
        botId: this.identity.botId,
        threadId: task.targetThreadId,
        userId: task.userId,
        currentContext: task.text,
      });
      if (opportunity.kind === "skip") {
        this.logInfo(
          `conversation topic skipped threadId=${task.targetThreadId} reason=${opportunity.reason}`,
        );
        return null;
      }
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

  private async findPendingInteraction(
    task: MentionQueueTask,
  ): Promise<string | null> {
    if (!this.resolvePendingInteraction) {
      return task.sourceInteractionId ?? null;
    }
    try {
      return await this.resolvePendingInteraction({
        botId: this.identity.botId,
        threadId: task.targetThreadId,
        userId: task.userId,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(
        `[simple-pomdp-error] pending interaction restore failed: ${message}\n`,
      );
      return task.sourceInteractionId ?? null;
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
