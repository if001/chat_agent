import { QueueStore, QueueTask } from "./types";

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
        try {
          await this.handler(task);
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          process.stdout.write(
            `[queue-handler-error] taskId=${task.id} action=${task.action} ${message}\n`,
          );
          await this.queue.release(task.id);
          currentNow = new Date();
          continue;
        }

        try {
          await this.queue.ack(task.id);
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          process.stdout.write(
            `[queue-ack-error] taskId=${task.id} ${message}\n`,
          );
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
