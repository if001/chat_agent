import { AgentRuntime, BotIdentity, ChannelMessage, KnowledgeRepository, WebClient } from "../../core/types";
import { handleMention } from "../../core/usecases/handleMention";
import { ingestSharedKnowledge } from "../../core/usecases/ingestSharedKnowledge";

export interface DiscordTransport {
  onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
  sendMessage(channelId: string, content: string): Promise<void>;
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

export class DiscordBotApp {
  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly repository: KnowledgeRepository,
    private readonly webClient: WebClient,
    private readonly transport: DiscordTransport,
  ) {}

  start(): void {
    this.transport.onMessage(async (message) => {
      const mentionReply = await handleMention(this.identity, this.runtime, message);
      if (mentionReply) {
        await this.transport.sendMessage(message.channelId, mentionReply);
      }

      const urls = message.content.match(URL_PATTERN) ?? [];
      for (const url of urls) {
        const saved = await ingestSharedKnowledge(
          this.identity,
          this.runtime,
          this.repository,
          this.webClient,
          url,
          `${message.channelId}:url`,
        );
        await this.transport.sendMessage(
          message.channelId,
          `保存しました: ${saved.title}\n要約: ${saved.summary}\narticleId: ${saved.articleId}`,
        );
      }
    });
  }
}
