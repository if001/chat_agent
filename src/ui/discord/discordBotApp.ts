import { AgentRuntime, BotIdentity, ChannelMessage } from "../../core/types";
import { handleMention } from "../../core/usecases/handleMention";
import { QueueStore, QueueTask } from "../../queue/types";
import { QueueWorker } from "../../queue/queueWorker";
import { formatAgentUserInput } from "../agentUserInput";

export interface DiscordTransport {
  onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
  sendMessage(channelId: string, content: string): Promise<void>;
  sendTyping(channelId: string): Promise<void>;
}

export class DiscordBotApp {
  private readonly queueStore: QueueStore;
  private readonly worker: QueueWorker;

  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly transport: DiscordTransport,
    private readonly mentionChannelId: string,
    queueOrDiscordBotUserId?: QueueStore | string,
    discordBotUserIdOrQueue?: string | QueueStore,
  ) {
    const queue = resolveQueueStore(
      queueOrDiscordBotUserId,
      discordBotUserIdOrQueue,
    );
    this.discordBotUserId = resolveDiscordBotUserId(
      queueOrDiscordBotUserId,
      discordBotUserIdOrQueue,
    );
    this.queueStore = queue ?? createInlineQueue();
    this.worker = new QueueWorker(
      this.queueStore,
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
      this.logInfo(`ignored channel=${message.channelId} reason=channel_mismatch`);
    });
  }

  private async enqueueUserTask(
    text: string,
    message: ChannelMessage,
  ): Promise<void> {
    const sanitizedText = sanitizeDiscordInput(text, this.discordBotUserId);
    const formattedText = formatAgentUserInput(sanitizedText);
    const task = await this.queueStore.enqueue({
      type: "user",
      action: "mention",
      text: formattedText,
      channelId: message.channelId,
      authorId: message.authorId,
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
      const mentionReply = await handleMention(this.identity, this.runtime, {
        channelId: task.channelId,
        authorId: task.authorId,
        content: task.text,
        mentionsBot: task.mentionsBot,
      });
      if (mentionReply) {
        await this.transport.sendMessage(task.channelId, mentionReply);
        this.logInfo(`replied id=${task.id} action=mention`);
      } else {
        this.logError(`no_reply id=${task.id} action=mention`);
      }
      return;
    }

    if (task.action === "agent_input") {
      this.sendTypingBestEffort(task.channelId);
      const result = await this.runtime.respond({
        botId: this.identity.botId,
        systemPrompt: this.identity.systemPrompt,
        threadId: `${task.channelId}:scheduled`,
        messages: [{ role: "user", content: task.text }],
      });
      if (result.content.length > 0) {
        await this.transport.sendMessage(task.channelId, result.content);
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

const resolveQueueStore = (
  first?: QueueStore | string,
  second?: QueueStore | string,
): QueueStore | undefined => {
  if (typeof first === "object") {
    return first;
  }
  if (typeof second === "object") {
    return second;
  }
  return undefined;
};

const resolveDiscordBotUserId = (
  first?: QueueStore | string,
  second?: QueueStore | string,
): string | undefined => {
  if (typeof first === "string") {
    return first;
  }
  if (typeof second === "string") {
    return second;
  }
  return undefined;
};

const createInlineQueue = (): QueueStore => {
  const items: QueueTask[] = [];
  return {
    enqueue: async (input) => {
      const task: QueueTask = {
        id: `inline_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: input.type,
        action: input.action,
        text: input.text,
        channelId: input.channelId,
        authorId: input.authorId,
        mentionsBot: input.mentionsBot,
        dueAt: input.dueAt.toISOString(),
        ...(input.intervalMinutes
          ? { intervalMinutes: input.intervalMinutes }
          : {}),
        createdAt: new Date().toISOString(),
        locked: false,
      };
      items.push(task);
      return task;
    },
    dequeueReady: async (now) => {
      const idx = items.findIndex(
        (it) => !it.locked && new Date(it.dueAt).getTime() <= now.getTime(),
      );
      if (idx < 0) {
        return null;
      }
      const current = items[idx];
      if (!current) {
        return null;
      }
      items[idx] = { ...current, locked: true };
      return items[idx] ?? null;
    },
    ack: async (id) => {
      const idx = items.findIndex((it) => it.id === id);
      if (idx >= 0) {
        items.splice(idx, 1);
      }
    },
    release: async (id) => {
      const idx = items.findIndex((it) => it.id === id);
      if (idx >= 0) {
        const current = items[idx];
        if (current) {
          items[idx] = { ...current, locked: false };
        }
      }
    },
  };
};
