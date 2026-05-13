import { QueueWorker } from "./queueWorker";
import { QueueStore, QueueTask } from "./types";

const createTask = (id: string, text: string): QueueTask => ({
  id,
  type: "user",
  action: "mention",
  text,
  channelId: "c1",
  authorId: "u1",
  mentionsBot: true,
  dueAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  locked: false,
});

test("processes queued tasks sequentially when a new task arrives during processing", async () => {
  const tasks = [createTask("1", "first"), createTask("2", "second")];
  const acked: string[] = [];
  let firstHandlerRelease: (() => void) | null = null;
  const started: string[] = [];
  const finished: string[] = [];

  const queue: QueueStore = {
    enqueue: async () => {
      throw new Error("not used");
    },
    dequeueReady: async () => {
      const next = tasks.shift();
      return next ?? null;
    },
    ack: async (taskId) => {
      acked.push(taskId);
    },
    release: async () => {},
  };

  const worker = new QueueWorker(queue, async (task) => {
    started.push(task.id);
    if (task.id === "1") {
      await new Promise<void>((resolve) => {
        firstHandlerRelease = resolve;
      });
    }
    finished.push(task.id);
  });

  worker.start();
  await Promise.resolve();
  expect(started).toEqual(["1"]);

  const secondTick = worker.tick();
  await Promise.resolve();

  expect(started).toEqual(["1"]);
  expect(finished).toEqual([]);

  firstHandlerRelease?.();
  await secondTick;
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(started).toEqual(["1", "2"]);
  expect(finished).toEqual(["1", "2"]);
  expect(acked).toEqual(["1", "2"]);

  worker.stop();
});

test("does not re-run a handled task when ack fails", async () => {
  const task = createTask("1", "first");
  let dequeueCount = 0;
  const handled: string[] = [];

  const queue: QueueStore = {
    enqueue: async () => {
      throw new Error("not used");
    },
    dequeueReady: async () => {
      dequeueCount += 1;
      return dequeueCount === 1 ? task : null;
    },
    ack: async () => {
      throw new Error("ack failed");
    },
    release: async () => {
      throw new Error("release must not be called after successful handling");
    },
  };

  const worker = new QueueWorker(queue, async (picked) => {
    handled.push(picked.id);
  });

  worker.start();
  await worker.tick();
  await worker.tick();

  expect(handled).toEqual(["1"]);
  worker.stop();
});
