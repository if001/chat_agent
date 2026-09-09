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
    userId: "discord-user-1",
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
    userId: "discord-user-1",
    systemPrompt: "You are helpful",
    threadId: "thread-2",
    messages: [{ role: "user", content: "followup" }],
  });

  expect(result.content).toBe("final answer");
});

test("reuses one bot agent while passing fresh request context on every invocation", async () => {
  const createdPrompts: string[] = [];
  const invocations: Array<Array<{ role: string; content: string }>> = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    ({ systemPrompt }) => {
      createdPrompts.push(systemPrompt);
      return {
        invoke: async (input) => {
          invocations.push(input.messages);
          return { messages: [{ role: "assistant", content: "ok" }] };
        },
      };
    },
    () => undefined,
    () => undefined,
  );

  for (const requestContext of ["time: first", "time: second"]) {
    await runtime.respond({
      botId: "ao",
      userId: "discord-user-1",
      systemPrompt: "static ao personality",
      requestContext,
      threadId: "thread-1",
      messages: [{ role: "user", content: "hello" }],
    });
  }

  expect(createdPrompts).toEqual(["static ao personality"]);
  expect(invocations.map((messages) => messages[0]?.content)).toEqual([
    "time: first",
    "time: second",
  ]);
});

test("separates cached agents and checkpoint thread IDs by bot", async () => {
  const created: string[] = [];
  const threadIds: string[] = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    ({ systemPrompt }) => {
      created.push(systemPrompt);
      return {
        invoke: async (_input, config) => {
          threadIds.push(config.configurable.thread_id);
          return { messages: [{ role: "assistant", content: "ok" }] };
        },
      };
    },
    () => undefined,
    () => undefined,
  );

  await runtime.respond({
    botId: "ao",
    userId: "u1",
    systemPrompt: "ao personality",
    threadId: "shared-thread",
    messages: [{ role: "user", content: "hello" }],
  });
  await runtime.respond({
    botId: "aka",
    userId: "u1",
    systemPrompt: "aka personality",
    threadId: "shared-thread",
    messages: [{ role: "user", content: "hello" }],
  });

  expect(created).toEqual(["ao personality", "aka personality"]);
  expect(threadIds).toEqual(["ao:shared-thread", "aka:shared-thread"]);
});

test("persists response origin metadata when a checkpoint thread resumes", async () => {
  const checkpointMessages = new Map<string, unknown[]>();
  const runtime = new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async (input, config) => {
        const threadId = config.configurable.thread_id;
        const messages = [
          ...(checkpointMessages.get(threadId) ?? []),
          ...input.messages,
          { role: "assistant", content: "ok" },
        ];
        checkpointMessages.set(threadId, messages);
        return { messages };
      },
    }),
    () => undefined,
    () => undefined,
  );

  await runtime.respond({
    botId: "ao",
    userId: "u1",
    systemPrompt: "ao personality",
    threadId: "thread-1",
    messages: [
      {
        role: "user",
        content: "proactive instruction",
        additional_kwargs: {
          response_input_origin: "proactive",
          source_interaction_id: "interaction-1",
        },
      },
    ],
  });

  await runtime.respond({
    botId: "ao",
    userId: "u1",
    systemPrompt: "ao personality",
    threadId: "thread-1",
    messages: [
      {
        role: "user",
        content: "human follow-up",
        additional_kwargs: { response_input_origin: "human" },
      },
    ],
  });

  expect(checkpointMessages.get("ao:thread-1")?.slice(0, 3)).toEqual([
    {
      role: "user",
      content: "proactive instruction",
      additional_kwargs: {
        response_input_origin: "proactive",
        source_interaction_id: "interaction-1",
      },
    },
    { role: "assistant", content: "ok" },
    {
      role: "user",
      content: "human follow-up",
      additional_kwargs: { response_input_origin: "human" },
    },
  ]);
});
