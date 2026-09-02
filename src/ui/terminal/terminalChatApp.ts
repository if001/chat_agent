import { AgentRuntime, BotIdentity } from "../../core/types";
import { formatAgentUserInput } from "../agentUserInput";
import { TurnRecordInput } from "../../infrastructure/memory/memorySystemClient";
import { RequestContextInput } from "../../infrastructure/agent/requestContextBuilder";

export const TERMINAL_USER_ID = "terminal-user";
export const TERMINAL_THREAD_ID = "terminal:default";

export class TerminalChatApp {
  constructor(
    private readonly identity: BotIdentity,
    private readonly runtime: AgentRuntime,
    private readonly onTurnRecorded?: (record: TurnRecordInput) => Promise<void>,
    private readonly resolveRequestContext?: (
      input: RequestContextInput,
    ) => Promise<string | undefined>,
  ) {}

  async ask(input: string): Promise<string> {
    const now = new Date();
    const requestContext = await this.resolveRequestContextBestEffort(input);
    const response = await this.runtime.respond({
      botId: this.identity.botId,
      userId: TERMINAL_USER_ID,
      threadId: TERMINAL_THREAD_ID,
      systemPrompt: this.identity.systemPrompt,
      ...(requestContext ? { requestContext } : {}),
      messages: [{ role: "user", content: formatAgentUserInput(input) }],
    });
    if (this.onTurnRecorded) {
      try {
        await this.onTurnRecorded({
          botId: this.identity.botId,
          threadId: TERMINAL_THREAD_ID,
          kind: "human",
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

  private async resolveRequestContextBestEffort(
    input: string,
  ): Promise<string | undefined> {
    if (!this.resolveRequestContext) {
      return undefined;
    }
    try {
      return await this.resolveRequestContext({
        botId: this.identity.botId,
        userId: TERMINAL_USER_ID,
        threadId: TERMINAL_THREAD_ID,
        currentContext: input,
        kind: "human",
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stdout.write(`[request-context-error] context build failed: ${message}\n`);
      return undefined;
    }
  }
}
