import { ChannelMessage } from "../../core/types";
import { DiscordTransport } from "../../ui/discord/discordBotApp";

interface DiscordTextChannel {
  id: string;
  send(content: string): Promise<void>;
  sendTyping(): Promise<void>;
}

interface DiscordMessage {
  content: string;
  author: { id: string; bot: boolean };
  channel: DiscordTextChannel;
  mentions: { has(userId: string): boolean };
}

interface DiscordClientLike {
  user: { id: string } | null;
  channels?: {
    fetch(channelId: string): Promise<unknown>;
  };
  on(event: "messageCreate", handler: (message: DiscordMessage) => Promise<void> | void): void;
}

export class DiscordJsTransport implements DiscordTransport {
  private handler: ((message: ChannelMessage) => Promise<void>) | null = null;
  private readonly channelMap = new Map<string, DiscordTextChannel>();
  private readonly allowedBotUserIds: Set<string>;

  constructor(
    private readonly client: DiscordClientLike,
    allowedBotUserIds: string[] = [],
  ) {
    this.allowedBotUserIds = new Set(allowedBotUserIds);
  }

  onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
    this.handler = handler;
    this.client.on("messageCreate", async (message) => {
      if (!this.handler || !this.client.user) {
        return;
      }
      if (message.author.id === this.client.user.id) {
        return;
      }
      if (
        message.author.bot &&
        !this.allowedBotUserIds.has(message.author.id)
      ) {
        return;
      }

      this.channelMap.set(message.channel.id, message.channel);

      await this.handler({
        channelId: message.channel.id,
        authorId: message.author.id,
        content: message.content,
        mentionsBot: message.mentions.has(this.client.user.id),
      });
    });
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const channel = await this.resolveChannel(channelId);
    const parts = splitDiscordMessage(content);
    for (const part of parts) {
      await channel.send(part);
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    const channel = await this.resolveChannel(channelId);
    await channel.sendTyping();
  }

  private async resolveChannel(channelId: string): Promise<DiscordTextChannel> {
    const cached = this.channelMap.get(channelId);
    if (cached) {
      return cached;
    }
    const fetched = await this.client.channels?.fetch(channelId);
    if (!isDiscordTextChannel(fetched)) {
      throw new Error(`Unknown channel id: ${channelId}`);
    }
    this.channelMap.set(channelId, fetched);
    return fetched;
  }
}

const DISCORD_MAX_MESSAGE_LENGTH = 2_000;

const splitDiscordMessage = (content: string): string[] => {
  if (content.length <= DISCORD_MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > DISCORD_MAX_MESSAGE_LENGTH) {
    const splitAt = findSplitPoint(remaining, DISCORD_MAX_MESSAGE_LENGTH);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
};

const findSplitPoint = (text: string, maxLen: number): number => {
  const candidate = text.slice(0, maxLen);
  const newlineIdx = candidate.lastIndexOf("\n");
  if (newlineIdx >= 0 && newlineIdx >= maxLen - 400) {
    return newlineIdx + 1;
  }
  const spaceIdx = candidate.lastIndexOf(" ");
  if (spaceIdx >= 0 && spaceIdx >= maxLen - 200) {
    return spaceIdx + 1;
  }
  return maxLen;
};

const isDiscordTextChannel = (value: unknown): value is DiscordTextChannel => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    send?: unknown;
    sendTyping?: unknown;
  };
  return (
    typeof candidate.send === "function" &&
    typeof candidate.sendTyping === "function"
  );
};
