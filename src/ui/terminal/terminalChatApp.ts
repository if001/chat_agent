import { AgentRuntime, BotIdentity } from "../../core/types";
import { formatAgentUserInput } from "../agentUserInput";

export class TerminalChatApp {
  constructor(private readonly identity: BotIdentity, private readonly runtime: AgentRuntime) {}

  async ask(input: string): Promise<string> {
    const response = await this.runtime.respond({
      botId: this.identity.botId,
      systemPrompt: this.identity.systemPrompt,
      messages: [{ role: "user", content: formatAgentUserInput(input) }],
    });

    return response.content;
  }
}
