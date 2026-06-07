import { TerminalChatApp } from "./terminalChatApp";
import { AgentRuntime, BotIdentity } from "../../core/types";

class RuntimeStub implements AgentRuntime {
  public lastContent = "";
  public lastSystemPrompt = "";

  async respond(request: {
    botId: string;
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ content: string }> {
    this.lastContent = request.messages.at(-1)?.content ?? "";
    this.lastSystemPrompt = request.systemPrompt;
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

test("records turn after response", async () => {
  const runtime = new RuntimeStub();
  const records: Array<{ botId: string; threadId: string }> = [];
  const app = new TerminalChatApp(identity, runtime, async (record) => {
    records.push({ botId: record.botId, threadId: record.threadId });
  });
  await app.ask("hello");
  expect(records).toEqual([{ botId: "bot-terminal", threadId: "terminal:default" }]);
});

test("still returns answer when turn recording fails", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(identity, runtime, async () => {
    throw new Error("record failed");
  });
  const result = await app.ask("hello");
  expect(result).toBe("terminal answer");
});

test("injects memory policy context into system prompt when resolver returns cards", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    async () => "1. policy title\n- recommendedBehavior: do x",
  );
  await app.ask("hello");
  expect(runtime.lastSystemPrompt).toContain("# Memory Policy Context");
  expect(runtime.lastSystemPrompt).toContain("policy title");
});

test("still returns answer when policy resolver fails", async () => {
  const runtime = new RuntimeStub();
  const app = new TerminalChatApp(
    identity,
    runtime,
    undefined,
    async () => {
      throw new Error("policy resolve failed");
    },
  );

  const result = await app.ask("hello");

  expect(result).toBe("terminal answer");
  expect(runtime.lastSystemPrompt).toBe(identity.systemPrompt);
});
