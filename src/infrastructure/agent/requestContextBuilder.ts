import {
  DailyEventRepository,
  UserMemoryStore,
} from "../../core/types";

export type RequestKind =
  | "human"
  | "conversation"
  | "proactive"
  | "delegation";

export interface RequestContextInput {
  botId: string;
  userId: string;
  threadId: string;
  currentContext: string;
  kind: RequestKind;
  proactiveEvidence?: string;
}

export interface PolicyContextReader {
  load(input: {
    botId: string;
    threadId: string;
    currentContext: string;
  }): Promise<string | undefined>;
}

export class RequestContextBuilder {
  constructor(
    private readonly userMemoryStore: UserMemoryStore,
    private readonly dailyEventRepository: DailyEventRepository,
    private readonly policyContextReader: PolicyContextReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async build(input: RequestContextInput): Promise<string> {
    const [notes, events, policy] = await Promise.all([
      loadOrDefault(
        () => this.userMemoryStore.searchUserNotes(input.userId, "", 10),
        [],
      ),
      loadOrDefault(
        () =>
          this.dailyEventRepository.searchDailyEvents({
            userId: input.userId,
            query: "",
            limit: 10,
          }),
        [],
      ),
      loadOrDefault(
        () =>
          this.policyContextReader.load({
            botId: input.botId,
            threadId: input.threadId,
            currentContext: input.currentContext,
          }),
        undefined,
      ),
    ]);

    const sections = [`# Request Context\nCurrent time: ${this.now().toISOString()}`];
    if (notes.length > 0) {
      sections.push(
        `## Shared UserMemory\n${notes.map((item) => `- ${item.note}`).join("\n")}`,
      );
    }
    if (events.length > 0) {
      sections.push(
        `## Shared DailyEvent\n${events
          .map((item) => `- ${item.eventDate}: ${item.summary}`)
          .join("\n")}`,
      );
    }
    if (policy?.trim()) {
      sections.push(`## Bot-specific PolicyCard\n${policy.trim()}`);
    }
    if (
      (input.kind === "conversation" || input.kind === "proactive") &&
      input.proactiveEvidence?.trim()
    ) {
      sections.push(
        `## Proactive Internal Context\n${input.proactiveEvidence.trim()}`,
      );
    }
    return sections.join("\n\n");
  }
}

const loadOrDefault = async <T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await load();
  } catch {
    return fallback;
  }
};
