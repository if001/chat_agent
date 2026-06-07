import { AgentRuntime, BotIdentity } from "../../core/types";
import { formatAgentUserInput } from "../agentUserInput";
import { TurnRecordInput } from "../../infrastructure/memory/memorySystemClient";

export class TerminalChatApp {
  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly onTurnRecorded?: (record: TurnRecordInput) => Promise<void>,
    private readonly resolvePolicyPrompt?: (input: {
      botId: string;
      threadId: string;
      currentContext: string;
    }) => Promise<string | undefined>,
  ) {}

  async ask(input: string): Promise<string> {
    const now = new Date();
    const policyPrompt = await this.resolvePolicyPromptBestEffort(input);
    const response = await this.runtime.respond({
      botId: this.identity.botId,
      systemPrompt: policyPrompt
        ? `${this.identity.systemPrompt}\n\n# Memory Policy Context\n${policyPrompt}`
        : this.identity.systemPrompt,
      messages: [{ role: "user", content: formatAgentUserInput(input) }],
    });
    if (this.onTurnRecorded) {
      try {
        await this.onTurnRecorded({
          botId: this.identity.botId,
          threadId: "terminal:default",
          messages: [
            { role: "user", content: input, timestampIso: now.toISOString() },
            {
              role: "assistant",
              content: response.content,
              timestampIso: new Date().toISOString(),
            },
          ],
          createdAtIso: new Date().toISOString(),
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stdout.write(`[memory-system-error] ${message}\n`);
      }
    }

    return response.content;
  }

  private async resolvePolicyPromptBestEffort(
    input: string,
  ): Promise<string | undefined> {
    if (!this.resolvePolicyPrompt) {
      return undefined;
    }
    try {
      return await this.resolvePolicyPrompt({
        botId: this.identity.botId,
        threadId: "terminal:default",
        currentContext: input,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(`[memory-system-error] policy resolve failed: ${message}\n`);
      return undefined;
    }
  }
}
