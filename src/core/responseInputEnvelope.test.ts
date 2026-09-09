import { QueueTask } from "@chat-agent/queue";
import {
  ResponseInputOrigin,
  createResponseInputEnvelope,
  responseInputCheckpointMessage,
  responseInputEnvelopeFromQueueTask,
  responseInputTurnRecord,
  runResponseInput,
} from "./responseInputEnvelope";
import { AgentRequest, AgentRuntime, BotIdentity } from "./types";

const identity: BotIdentity = {
  botId: "ao",
  systemPrompt: "ao prompt",
};

const task = (
  source: QueueTask["source"],
  action: QueueTask["action"],
): QueueTask =>
  ({
    id: `${source}-1`,
    type: action === "mention" ? "user" : "scheduled_once",
    action,
    text: `${source} instruction`,
    channelId: "channel-1",
    userId: "user-1",
    targetThreadId: "channel-1:user-1",
    conversationVersion: 1,
    source,
    sourceInteractionId: "interaction-1",
    dueAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
    locked: false,
    ...(action === "mention"
      ? { authorId: "user-1", mentionsBot: true }
      : {}),
  }) as QueueTask;

test.each([
  [task("user", "mention"), "human"],
  [task("scheduled", "agent_input"), "proactive"],
  [task("simple_pomdp", "agent_input"), "proactive"],
] as const)("maps queue source $source to $origin envelope", (queueTask, origin) => {
  expect(
    responseInputEnvelopeFromQueueTask("ao", queueTask),
  ).toEqual({
    botId: "ao",
    userId: "user-1",
    threadId: "channel-1:user-1",
    channelId: "channel-1",
    content: `${queueTask.source} instruction`,
    origin,
    sourceInteractionId: "interaction-1",
  });
});

test("checkpoint user message retains origin, interaction ID, and pseudo-human content", () => {
  const envelope = responseInputEnvelopeFromQueueTask(
    "ao",
    task("scheduled", "agent_input"),
    "interaction-1",
  );

  expect(responseInputCheckpointMessage(envelope)).toEqual({
    role: "user",
    content: "scheduled instruction",
    additional_kwargs: {
      response_input_origin: "proactive",
      source_interaction_id: "interaction-1",
    },
  });
});

test("human, proactive, and delegation use the same response runner", async () => {
  const requests: AgentRequest[] = [];
  const runtime: AgentRuntime = {
    respond: async (request) => {
      requests.push(request);
      return { content: `reply:${request.messages[0]?.content}` };
    },
  };
  const origins: ResponseInputOrigin[] = [
    "human",
    "proactive",
    "delegation",
  ];

  for (const origin of origins) {
    const content = await runResponseInput(
      identity,
      runtime,
      createResponseInputEnvelope({
        botId: "ao",
        userId: "user-1",
        threadId: "thread-1",
        channelId: "channel-1",
        content: `${origin} content`,
        origin,
      }),
    );
    expect(content).toBe(`reply:${origin} content`);
  }

  expect(
    requests.map(
      (request) =>
        request.messages[0]?.additional_kwargs?.response_input_origin,
    ),
  ).toEqual(origins);
  expect(new Set(requests.map((request) => request.threadId))).toEqual(
    new Set(["thread-1"]),
  );
});

test.each<ResponseInputOrigin>(["human", "proactive", "delegation"])(
  "maps %s checkpoint origin to the same TurnRecord kind",
  (origin) => {
    const record = responseInputTurnRecord(
      createResponseInputEnvelope({
        botId: "ao",
        userId: "user-1",
        threadId: "thread-1",
        channelId: "channel-1",
        content: `${origin} raw instruction`,
        origin,
        sourceInteractionId: "interaction-1",
      }),
      "assistant reply",
      "2026-09-09T00:00:00.000Z",
    );

    expect(record).toMatchObject({
      kind: origin,
      sourceInteractionId: "interaction-1",
      messages: [
        { role: "user", content: `${origin} raw instruction` },
        { role: "assistant", content: "assistant reply" },
      ],
    });
  },
);
