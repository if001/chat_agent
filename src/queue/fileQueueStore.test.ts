import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileQueueStore } from "./fileQueueStore";

const createPath = () => join(tmpdir(), `queue_test_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`);

test("dequeue prioritizes user over scheduled tasks", async () => {
  const path = createPath();
  const queue = new FileQueueStore(path);
  const now = new Date();

  await queue.enqueue({
    type: "scheduled_once",
    action: "agent_input",
    text: "once",
    channelId: "c1",
    authorId: "u1",
    mentionsBot: false,
    dueAt: now,
  });
  await queue.enqueue({
    type: "scheduled_recurring",
    action: "agent_input",
    text: "recurring",
    channelId: "c1",
    authorId: "u1",
    mentionsBot: false,
    dueAt: now,
    intervalMinutes: 180,
  });
  await queue.enqueue({
    type: "user",
    action: "mention",
    text: "user",
    channelId: "c1",
    authorId: "u1",
    mentionsBot: true,
    dueAt: now,
  });

  const first = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(first?.type).toBe("user");
  if (first) {
    await queue.ack(first.id);
  }

  const second = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(second?.type).toBe("scheduled_recurring");
  if (second) {
    await queue.ack(second.id);
  }

  const third = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(third?.type).toBe("scheduled_once");

  await rm(path, { force: true });
});

test("ack keeps recurring task and reschedules dueAt", async () => {
  const path = createPath();
  const queue = new FileQueueStore(path);
  const now = new Date();

  await queue.enqueue({
    type: "scheduled_recurring",
    action: "agent_input",
    text: "repeat",
    channelId: "c1",
    authorId: "u1",
    mentionsBot: false,
    dueAt: now,
    intervalMinutes: 60,
  });

  const picked = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(picked).not.toBeNull();
  if (!picked) {
    throw new Error("task not found");
  }

  await queue.ack(picked.id);
  const immediately = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(immediately).toBeNull();

  await rm(path, { force: true });
});
