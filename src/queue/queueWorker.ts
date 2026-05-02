import { QueueStore, QueueTask } from "./types";

export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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
    const task = await this.queue.dequeueReady(now);
    if (!task) {
      return;
    }
    try {
      await this.handler(task);
      await this.queue.ack(task.id);
    } catch {
      await this.queue.release(task.id);
    }
  }
}
