import { AsyncLocalStorage } from "node:async_hooks";

export interface TrustedAgentContext {
  botId: string;
  userId: string;
  threadId: string;
}

export class AgentRuntimeContext {
  private readonly storage = new AsyncLocalStorage<TrustedAgentContext>();

  run<T>(context: TrustedAgentContext, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(context, operation);
  }

  current(): TrustedAgentContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new Error("agent tool invoked outside a trusted request context");
    }
    return context;
  }
}
