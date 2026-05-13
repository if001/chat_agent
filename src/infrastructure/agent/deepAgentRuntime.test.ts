import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { DeepAgentRuntime } from "./deepAgentRuntime";

const createRuntime = (messages: unknown[]) =>
  new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async () => ({ messages }),
    }),
    () => undefined,
    () => undefined,
  );

test("respond extracts content from AIMessage results", async () => {
  const runtime = createRuntime([
    new HumanMessage("user input message"),
    new AIMessage({
      content: "result message",
      additional_kwargs: { reasoning_content: "reasoning_content sample\n" },
    }),
  ]);

  const result = await runtime.respond({
    botId: "ao",
    systemPrompt: "You are helpful",
    threadId: "thread-1",
    messages: [{ role: "user", content: "user input message" }],
  });

  expect(result.content).toBe("result message");
});

test("respond falls back to last assistant-like message in mixed history", async () => {
  const runtime = createRuntime([
    { role: "user", content: "hello" },
    new AIMessage("first"),
    new HumanMessage("followup"),
    new AIMessage("final answer"),
  ]);

  const result = await runtime.respond({
    botId: "ao",
    systemPrompt: "You are helpful",
    threadId: "thread-2",
    messages: [{ role: "user", content: "followup" }],
  });

  expect(result.content).toBe("final answer");
});
