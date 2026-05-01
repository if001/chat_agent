import { AgentRuntime, BotIdentity } from "../../core/types";

export class TerminalChatApp {
  constructor(private readonly identity: BotIdentity, private readonly runtime: AgentRuntime) {}

  async ask(input: string): Promise<string> {
    const response = await this.runtime.respond({
      botId: this.identity.botId,
      systemPrompt: this.identity.systemPrompt,
      messages: [{ role: "user", content: input }],
    });

    return response.content;
  }
}
