import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { DeepAgentRuntime } from "./deepAgentRuntime";
import { AgentRuntimeContext } from "./runtimeContext";

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

test("bounds the agent tool loop for each response", async () => {
  const limits: Array<number | undefined> = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async (_input, config) => {
        limits.push(config.recursionLimit);
        return { messages: [{ role: "assistant", content: "ok" }] };
      },
    }),
    () => undefined,
    () => undefined,
  );

  await runtime.respond({
    botId: "ao",
    userId: "user-1",
    systemPrompt: "ao",
    threadId: "thread-1",
    messages: [{ role: "user", content: "hello" }],
  });

  expect(limits).toEqual([30]);
});

test("logs tool names, arguments, outputs, and errors", async () => {
  let callbacks: BaseCallbackHandler[] | undefined;
  const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const runtime = new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async (_input, config) => {
        callbacks = config.callbacks;
        return { messages: [{ role: "assistant", content: "ok" }] };
      },
    }),
    () => undefined,
    () => undefined,
  );

  await runtime.respond({
    botId: "ao",
    userId: "user-1",
    systemPrompt: "ao",
    threadId: "thread-1",
    messages: [{ role: "user", content: "remember jazz" }],
  });

  const callback = callbacks?.[0];
  callback?.handleToolStart?.(
    { name: "fallback_name" } as never,
    '{"query":"jazz"}',
    "run-success",
    undefined,
    undefined,
    undefined,
    "search_user_memory",
  );
  callback?.handleToolEnd?.({ status: "found" }, "run-success");
  const toolError = new Error("tool failed");
  callback?.handleToolStart?.(
    { name: "web_page" } as never,
    '{"url":"https://example.com"}',
    "run-error",
  );
  callback?.handleToolError?.(toolError, "run-error");

  expect(info).toHaveBeenCalledWith("[agent-tool:start]", {
    tool: "search_user_memory",
    arguments: '{"query":"jazz"}',
    runId: "run-success",
  });
  expect(info).toHaveBeenCalledWith("[agent-tool:end]", {
    tool: "search_user_memory",
    output: { status: "found" },
    runId: "run-success",
  });
  expect(error).toHaveBeenCalledWith("[agent-tool:error]", {
    tool: "web_page",
    error: toolError,
    runId: "run-error",
  });

  info.mockRestore();
  error.mockRestore();
});

test("agent fixture inspects the catalog before scoped retrieval and skips tools for greetings", async () => {
  const calls: string[] = [];
  const toolFixtures = [
    {
      name: "inspect_context_catalog",
      invoke: async () => {
        calls.push("inspect_context_catalog");
        return JSON.stringify({
          memory: {
            userMemory: { status: "available", topics: ["music preference"] },
          },
        });
      },
    },
    {
      name: "search_user_memory",
      invoke: async () => {
        calls.push("search_user_memory");
        return JSON.stringify({ status: "found", data: [{ note: "prefers jazz" }] });
      },
    },
  ];
  const runtime = new DeepAgentRuntime(
    {},
    toolFixtures,
    ({ tools }) => ({
      invoke: async (input) => {
        const text = input.messages.at(-1)?.content ?? "";
        if (text.includes("remember my music")) {
          const availableTools = tools as typeof toolFixtures;
          await availableTools.find((item) => item.name === "inspect_context_catalog")?.invoke();
          await availableTools.find((item) => item.name === "search_user_memory")?.invoke();
        }
        return { messages: [{ role: "assistant", content: "ok" }] };
      },
    }),
    () => undefined,
    () => undefined,
  );
  const base = {
    botId: "ao",
    userId: "user-1",
    systemPrompt: "ao",
    threadId: "thread-1",
  };

  await runtime.respond({
    ...base,
    messages: [{ role: "user", content: "remember my music preference" }],
  });
  await runtime.respond({
    ...base,
    messages: [{ role: "user", content: "hello" }],
  });

  expect(calls).toEqual(["inspect_context_catalog", "search_user_memory"]);
});

test("keeps raw application thread scope in trusted runtime context", async () => {
  const runtimeContext = new AgentRuntimeContext();
  const observed: unknown[] = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async () => {
        observed.push(runtimeContext.current());
        return { messages: [{ role: "assistant", content: "ok" }] };
      },
    }),
    () => undefined,
    () => undefined,
    runtimeContext,
  );

  await runtime.respond({
    botId: "ao",
    userId: "user-1",
    systemPrompt: "ao",
    threadId: "discord-thread",
    messages: [{ role: "user", content: "remember jazz" }],
  });

  expect(observed).toEqual([
    { botId: "ao", userId: "user-1", threadId: "discord-thread" },
  ]);
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

test("disables the fixed DeepAgent summarizer for each checkpoint invocation", async () => {
  const configs: unknown[] = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    () => ({
      invoke: async (_input, config) => {
        configs.push(config);
        return { messages: [{ role: "assistant", content: "ok" }] };
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
    messages: [{ role: "user", content: "hello" }],
  });

  expect(configs).toEqual([
    expect.objectContaining({
      configurable: { thread_id: "ao:thread-1" },
      context: { trigger: { tokens: Number.MAX_SAFE_INTEGER } },
      recursionLimit: 30,
      callbacks: expect.any(Array),
    }),
  ]);
});
