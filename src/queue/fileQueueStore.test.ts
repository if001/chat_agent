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
    userId: "u1",
    channelId: "c1",
    text: "once",
    dueAt: now,
  });
  await queue.enqueueScheduledInput({
    botId: "bot-1",
    userId: "u1",
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
    userId: "u1",
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

test("persists versions and coalesces input received during processing", async () => {
  const path = createPath();
  const now = new Date();
  const queue = createQueueApi(new FileQueueStore(path));

  const first = await queue.enqueueMention({
    botId: "bot-1",
    userId: "u1",
    channelId: "c1",
    text: "first",
    mentionsBot: true,
    dueAt: now,
  });
  expect(first.conversationVersion).toBe(1);
  expect((await queue.getStatus(now, 1)).next[0]).toMatchObject({
    targetThreadId: "c1:u1",
    conversationVersion: 1,
  });
  const processing = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(processing?.id).toBe(first.id);

  await queue.enqueueMention({
    botId: "bot-1",
    userId: "u1",
    channelId: "c1",
    text: "second",
    mentionsBot: true,
    dueAt: now,
  });
  await queue.enqueueMention({
    botId: "bot-1",
    userId: "u1",
    channelId: "c1",
    text: "third",
    mentionsBot: true,
    dueAt: now,
  });

  const restartedQueue = createQueueApi(new FileQueueStore(path));
  expect(
    await restartedQueue.getLatestConversationVersion("c1:u1"),
  ).toBe(3);
  const replanned = await restartedQueue.dequeueReady(
    new Date(now.getTime() + 1),
  );
  expect(replanned).toMatchObject({
    targetThreadId: "c1:u1",
    conversationVersion: 3,
  });
  expect(replanned?.text).toContain("first");
  expect(replanned?.text).toContain("second");
  expect(replanned?.text).toContain("third");

  await rm(path, { force: true });
});

test("serializes concurrent input into one monotonically versioned task", async () => {
  const path = createPath();
  const now = new Date();
  const queue = createQueueApi(new FileQueueStore(path));

  const created = await Promise.all(
    ["one", "two", "three"].map((text) =>
      queue.enqueueMention({
        botId: "bot-1",
        userId: "u1",
        channelId: "c1",
        text,
        mentionsBot: true,
        dueAt: now,
      }),
    ),
  );
  expect(created.map((task) => task.conversationVersion)).toEqual([1, 2, 3]);

  const onlyTask = await queue.dequeueReady(new Date(now.getTime() + 1));
  expect(onlyTask?.conversationVersion).toBe(3);
  expect(onlyTask?.text).toContain("one");
  expect(onlyTask?.text).toContain("two");
  expect(onlyTask?.text).toContain("three");
  if (onlyTask) {
    await queue.ack(onlyTask.id);
  }
  expect(await queue.dequeueReady(new Date(now.getTime() + 1))).toBeNull();

  await rm(path, { force: true });
});
