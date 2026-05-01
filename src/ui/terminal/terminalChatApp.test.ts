import { TerminalChatApp } from "./terminalChatApp";
import { AgentRuntime, BotIdentity } from "../../core/types";

class RuntimeStub implements AgentRuntime {
  async respond(): Promise<{ content: string }> {
    return { content: "terminal answer" };
  }
}

const identity: BotIdentity = {
  botId: "bot-terminal",
  systemPrompt: "You are terminal bot",
};

test("returns runtime answer", async () => {
  const app = new TerminalChatApp(identity, new RuntimeStub());
  const result = await app.ask("hello");
  expect(result).toBe("terminal answer");
});
