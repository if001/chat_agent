import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  checkpointSummarizationTriggerTokens,
  compactToolMessage,
  createCheckpointSummarizationMiddleware,
  findInteractionCutoff,
} from "./checkpointSummarization";

type MiddlewareUpdate = { messages?: BaseMessage[] } | undefined;

const invokeBeforeModel = async (
  middleware: ReturnType<typeof createCheckpointSummarizationMiddleware>,
  messages: BaseMessage[],
): Promise<MiddlewareUpdate> => {
  const beforeModel = middleware.beforeModel as unknown as (
    state: { messages: BaseMessage[] },
    runtime: { context: Record<string, never> },
  ) => Promise<MiddlewareUpdate>;
  return beforeModel({ messages }, { context: {} });
};

const interaction = (number: number): BaseMessage[] => [
  new HumanMessage({ id: `human-${number}`, content: `question ${number}` }),
  new AIMessage({ id: `ai-${number}`, content: `answer ${number}` }),
];

const createMiddlewareForTest = (overrides: {
  tokenCounter?: () => number;
  recentInteractions?: number;
  toolResultMaxChars?: number;
  summaries?: string[];
} = {}) => {
  const summaries = overrides.summaries ?? [];
  return createCheckpointSummarizationMiddleware({
    model: {
      invoke: async (prompt) => {
        summaries.push(prompt);
        return { content: `summary ${summaries.length}` };
      },
    },
    contextWindowTokens: 100,
    triggerFraction: 0.7,
    recentInteractions: overrides.recentInteractions ?? 2,
    toolResultMaxChars: overrides.toolResultMaxChars ?? 80,
    tokenCounter: overrides.tokenCounter ?? (() => 100),
  });
};

test("starts summarization before the configured model context limit", async () => {
  let tokens = 69;
  const summaries: string[] = [];
  const middleware = createMiddlewareForTest({
    summaries,
    tokenCounter: () => tokens,
  });
  const messages = [
    ...interaction(1),
    ...interaction(2),
    ...interaction(3),
  ];

  expect(checkpointSummarizationTriggerTokens(100, 0.7)).toBe(70);
  expect(await invokeBeforeModel(middleware, messages)).toBeUndefined();
  tokens = 70;
  expect((await invokeBeforeModel(middleware, messages))?.messages).toHaveLength(
    6,
  );
  expect(summaries).toHaveLength(1);
});

test("keeps the configured number of complete interactions and active tool state", async () => {
  const toolCall = new AIMessage({
    id: "ai-tool",
    content: "",
    tool_calls: [{ id: "call-1", name: "lookup", args: { q: "status" } }],
  });
  const toolResult = new ToolMessage({
    id: "tool-1",
    tool_call_id: "call-1",
    content: "lookup result",
  });
  const messages = [
    ...interaction(1),
    new SystemMessage({ id: "context-2", content: "current request context" }),
    new HumanMessage({ id: "human-2", content: "question 2" }),
    toolCall,
    toolResult,
    ...interaction(3),
  ];

  expect(findInteractionCutoff(messages, 2)).toBe(2);
  const update = await invokeBeforeModel(createMiddlewareForTest(), messages);
  const preserved = update?.messages?.slice(2) ?? [];

  expect(preserved.map((message) => message.id)).toEqual([
    "context-2",
    "human-2",
    "ai-tool",
    "tool-1",
    "human-3",
    "ai-3",
  ]);
  expect((preserved[3] as ToolMessage).tool_call_id).toBe("call-1");
});

test("shortens a large tool result without losing its checkpoint identity", () => {
  const message = new ToolMessage({
    id: "tool-large",
    tool_call_id: "call-large",
    content: "x".repeat(500),
  });

  const compacted = compactToolMessage(message, 100);

  expect(compacted).not.toBe(message);
  expect(compacted.id).toBe("tool-large");
  expect(compacted.tool_call_id).toBe("call-large");
  expect(String(compacted.content)).toHaveLength(100);
  expect(String(compacted.content)).toContain("tool result shortened");
});

test("a resumed checkpoint replaces its prior summary and keeps recent interactions", async () => {
  const summaries: string[] = [];
  const middleware = createMiddlewareForTest({ summaries });
  const firstUpdate = await invokeBeforeModel(middleware, [
    ...interaction(1),
    ...interaction(2),
    ...interaction(3),
  ]);
  const firstCheckpoint = firstUpdate?.messages?.slice(1) ?? [];

  const resumedUpdate = await invokeBeforeModel(middleware, [
    ...firstCheckpoint,
    ...interaction(4),
    ...interaction(5),
  ]);
  const resumedCheckpoint = resumedUpdate?.messages?.slice(1) ?? [];

  expect(summaries).toHaveLength(2);
  expect(summaries[1]).toContain("summary 1");
  expect(
    resumedCheckpoint.filter(
      (message) => message.additional_kwargs.lc_source === "interaction_summarization",
    ),
  ).toHaveLength(1);
  expect(resumedCheckpoint.map((message) => message.id).slice(1)).toEqual([
    "human-4",
    "ai-4",
    "human-5",
    "ai-5",
  ]);
});

test("compaction keeps an agent-initiated turn linked to the user's reaction", async () => {
  const proactive = new HumanMessage({
    id: "proactive-1",
    content: "agent initiated topic",
    additional_kwargs: {
      response_input_origin: "proactive",
      source_interaction_id: "interaction-1",
    },
  });
  const reaction = new HumanMessage({
    id: "reaction-1",
    content: "user reaction",
    additional_kwargs: {
      response_input_origin: "human",
      source_interaction_id: "interaction-1",
    },
  });
  const update = await invokeBeforeModel(createMiddlewareForTest(), [
    ...interaction(1),
    proactive,
    new AIMessage({ id: "proactive-reply", content: "topic reply" }),
    reaction,
    new AIMessage({ id: "reaction-reply", content: "reaction reply" }),
  ]);
  const preserved = update?.messages?.slice(1) ?? [];

  expect(preserved.map((message) => message.id).slice(-4)).toEqual([
    "proactive-1",
    "proactive-reply",
    "reaction-1",
    "reaction-reply",
  ]);
  expect(
    preserved.find((message) => message.id === "proactive-1")
      ?.additional_kwargs,
  ).toMatchObject({
    response_input_origin: "proactive",
    source_interaction_id: "interaction-1",
  });
  expect(
    preserved.find((message) => message.id === "reaction-1")
      ?.additional_kwargs,
  ).toMatchObject({
    response_input_origin: "human",
    source_interaction_id: "interaction-1",
  });
});
