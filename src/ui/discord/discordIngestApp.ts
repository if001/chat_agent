import { AgentRuntime, BotIdentity, ChannelMessage, KnowledgeRepository, WebClient } from "../../core/types";
import { ingestSharedKnowledge } from "../../core/usecases/ingestSharedKnowledge";
import { DiscordTransport } from "./discordBotApp";

const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

export class DiscordIngestApp {
  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly repository: KnowledgeRepository,
    private readonly webClient: WebClient,
    private readonly transport: DiscordTransport,
    private readonly ingestChannelId: string,
    private readonly logger: (message: string) => void = console.log,
  ) {}

  start(): void {
    this.transport.onMessage(async (message) => {
      if (message.channelId !== this.ingestChannelId) {
        return;
      }

      const urls = message.content.match(URL_PATTERN) ?? [];
      for (const url of urls) {
        try {
          await this.processUrl(message, url);
        } catch (error: unknown) {
          const detail =
            error instanceof Error ? error.stack ?? error.message : String(error);
          this.logger(
            `[ingest-error] channel=${message.channelId} url=${url}\n${detail}`,
          );
          await this.transport.sendMessage(
            message.channelId,
            `URLの取り込み中にエラーが発生しました: ${url}`,
          );
        }
      }
    });
  }

  private async processUrl(message: ChannelMessage, url: string): Promise<void> {
    await this.transport.sendTyping(message.channelId);
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
}
