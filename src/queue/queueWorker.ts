import { QueueStore, QueueTask } from "@chat-agent/queue";

export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private pendingTick = false;

  constructor(
    private readonly queue: QueueStore,
    private readonly handler: (task: QueueTask) => Promise<void>,
    private readonly pollMs: number = 2_000,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    // Avoid keeping the Node event loop alive (important for tests).
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (!this.running) {
      return;
    }
    if (this.processing) {
      this.pendingTick = true;
      return;
    }

    this.processing = true;
    try {
      let currentNow = now;
      while (this.running) {
        const task = await this.queue.dequeueReady(currentNow);
        if (!task) {
          return;
        }
        process.stdout.write(
          `[DEBUG-pomdp-queue] dequeued taskId=${task.id} action=${task.action} source=${task.source} interactionId=${task.sourceInteractionId ?? "none"} threadId=${task.targetThreadId} dueAt=${task.dueAt} conversationVersion=${task.conversationVersion}\n`,
        );
        try {
          await this.handler(task);
        } catch (error: unknown) {
          const queueError = toQueueError(error);
          process.stdout.write(
            `[queue-handler-error] taskId=${task.id} action=${task.action} ${queueError.name}: ${queueError.message}\n`,
          );
          await this.queue.release(task.id, undefined, queueError);
          process.stdout.write(
            `[DEBUG-pomdp-queue] released taskId=${task.id} reason=handler_failed\n`,
          );
          currentNow = new Date();
          continue;
        }

        try {
          await this.queue.ack(task.id);
          process.stdout.write(
            `[DEBUG-pomdp-queue] acked taskId=${task.id}\n`,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? (error.stack ?? error.message) : String(error);
          process.stdout.write(`[queue-ack-error] taskId=${task.id} ${message}\n`);
          return;
        }
        currentNow = new Date();
      }
    } finally {
      this.processing = false;
      if (this.pendingTick && this.running) {
        this.pendingTick = false;
        await this.tick(new Date());
      }
    }
  }
}

const toQueueError = (error: unknown): { name: string; message: string } =>
  error instanceof Error
    ? { name: error.name || "Error", message: error.message }
    : { name: "Error", message: String(error) };
