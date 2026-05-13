import { TerminalChatApp } from "./terminalChatApp";
import { AgentRuntime, BotIdentity } from "../../core/types";

class RuntimeStub implements AgentRuntime {
  public lastContent = "";

  async respond(request: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ content: string }> {
    this.lastContent = request.messages.at(-1)?.content ?? "";
    return { content: "terminal answer" };
  }
}

const identity: BotIdentity = {
  botId: "bot-terminal",
  systemPrompt: "You are terminal bot",
};

test("returns runtime answer", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(identity, runtime);
  const result = await app.ask("hello");
  expect(result).toBe("terminal answer");
  expect(runtime.lastContent).toMatch(/^Current time: .*Z\n\nUser message:\nhello$/);
});
