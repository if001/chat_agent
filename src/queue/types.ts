export type QueueTaskType = "user" | "scheduled_recurring" | "scheduled_once";
export type QueueTaskAction = "mention" | "agent_input";

export interface QueueTask {
  id: string;
  type: QueueTaskType;
  action: QueueTaskAction;
  text: string;
  channelId: string;
  authorId: string;
  mentionsBot: boolean;
  dueAt: string;
  intervalMinutes?: number;
  createdAt: string;
  locked: boolean;
}

export interface EnqueueTaskInput {
  type: QueueTaskType;
  action: QueueTaskAction;
  text: string;
  channelId: string;
  authorId: string;
  mentionsBot: boolean;
  dueAt: Date;
  intervalMinutes?: number;
}

export interface QueueStore {
  enqueue(input: EnqueueTaskInput): Promise<QueueTask>;
  dequeueReady(now: Date): Promise<QueueTask | null>;
  ack(taskId: string): Promise<void>;
  release(taskId: string, nextDueAt?: Date): Promise<void>;
}
