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
    const channel = this.channelMap.get(channelId);
    if (!channel) {
      throw new Error(`Unknown channel id: ${channelId}`);
    }
    await channel.send(content);
  }

  async sendTyping(channelId: string): Promise<void> {
    const channel = this.channelMap.get(channelId);
    if (!channel) {
      throw new Error(`Unknown channel id: ${channelId}`);
    }
    await channel.sendTyping();
  }
}
