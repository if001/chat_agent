import { createQueueApi, FileQueueStore } from "@chat-agent/queue";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const createPath = () =>
  join(
    tmpdir(),
    `queue_test_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`,
  );

test("dequeue prioritizes user over scheduled tasks", async () => {
  const path = createPath();
  const queue = createQueueApi(new FileQueueStore(path));
  const now = new Date();

  await queue.enqueueScheduledInput({
    botId: "bot-1",
    channelId: "c1",
    text: "once",
    dueAt: now,
  });
  await queue.enqueueScheduledInput({
    botId: "bot-1",
    channelId: "c1",
    text: "recurring",
    dueAt: now,
    intervalMinutes: 180,
  });
  await queue.enqueueMention({
    botId: "bot-1",
    userId: "u1",
    channelId: "c1",
    text: "user",
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
  const queue = createQueueApi(new FileQueueStore(path));
  const now = new Date();

  await queue.enqueueScheduledInput({
    botId: "bot-1",
    channelId: "c1",
    text: "repeat",
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
