import { createQueueApi, QueueTask } from "@chat-agent/queue";

test("conversation and scheduled tasks coexist at the current conversation version", async () => {
  const inputs: unknown[] = [];
  const queue = createQueueApi({
    enqueueMentionTask: async () => { throw new Error("not used"); },
    enqueueTask: async (input) => { inputs.push(input); return { id: "task-" + inputs.length, ...input, createdAt: "2026-08-30T00:00:00.000Z", locked: false } as QueueTask; },
    dequeueReady: async () => null, ack: async () => undefined, release: async () => undefined,
    getStatus: async () => ({ now: "2026-08-30T00:00:00.000Z", counts: { total: 0, locked: 0, byType: { user: 0, scheduled_recurring: 0, scheduled_once: 0 }, readyByType: { user: 0, scheduled_recurring: 0, scheduled_once: 0 } }, next: [] }),
    getLatestConversationVersion: async () => 7,
  });
  await queue.enqueueConversationInput({ botId: "ao", userId: "u1", channelId: "c1", text: "conversation", source: "simple_pomdp", sourceInteractionId: "interaction-1", dueAt: new Date("2026-08-30T01:00:00.000Z") });
  await queue.enqueueScheduledInput({ botId: "ao", userId: "u1", channelId: "c1", text: "scheduled", dueAt: new Date("2026-08-30T02:00:00.000Z") });
  expect(inputs).toEqual([
    { type: "scheduled_once", action: "agent_input", text: "conversation", channelId: "c1", userId: "u1", targetThreadId: "c1:u1", conversationVersion: 7, source: "simple_pomdp", sourceInteractionId: "interaction-1", dueAt: "2026-08-30T01:00:00.000Z" },
    { type: "scheduled_once", action: "agent_input", text: "scheduled", channelId: "c1", userId: "u1", targetThreadId: "c1:u1", conversationVersion: 7, source: "scheduled", dueAt: "2026-08-30T02:00:00.000Z" },
  ]);
});
