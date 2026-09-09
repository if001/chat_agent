import { MemorySystemClient } from "../memory/memorySystemClient";
import {
  ConversationAnalysisService,
  ConversationFocus,
  formatConversationFocus,
} from "./conversationFocus";

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
  conversationFocus?: ConversationFocus | null;
}

export interface PolicyContextReader {
  load(input: {
    botId: string;
    threadId: string;
    userId: string;
    currentContext: string;
  }): Promise<string | undefined>;
}

export interface KnowledgeContextItem {
  articleId: string;
  title: string;
  summary: string;
  tags: string[];
  url: string;
}

export interface KnowledgeContextReader {
  searchRelevant(input: {
    query: string;
    limit: number;
  }): Promise<KnowledgeContextItem[]>;
}

export class RequestContextBuilder {
  constructor(
    private readonly userMemoryClient: Pick<MemorySystemClient, "searchUserNotes">,
    private readonly dailyEventClient: Pick<MemorySystemClient, "searchDailyEvents">,
    private readonly policyContextReader: PolicyContextReader,
    private readonly now: () => Date = () => new Date(),
    private readonly conversationAnalysisService?: ConversationAnalysisService,
    private readonly knowledgeContextReader?: KnowledgeContextReader,
  ) {}

  async build(input: RequestContextInput): Promise<string> {
    const analysisService = this.conversationAnalysisService;
    const hasPrecomputedFocus = "conversationFocus" in input;
    const focus = hasPrecomputedFocus
      ? input.conversationFocus ?? null
      : analysisService
        ? await loadOrDefault(
            () =>
              analysisService
                .analyze({
                  botId: input.botId,
                  threadId: input.threadId,
                  currentContext: input.currentContext,
                })
                .then(({ focus: analyzedFocus }) => analyzedFocus),
            null,
          )
        : null;

    const sections = [
      `# Request Context\nCurrent time: ${this.now().toISOString()}\nInput origin: ${input.kind}`,
    ];
    const formattedFocus = formatConversationFocus(focus);
    if (formattedFocus) {
      sections.push(`## Conversation Focus\n${formattedFocus}`);
    }
    if (
      (input.kind === "conversation" || input.kind === "proactive") &&
      input.proactiveEvidence?.trim()
    ) {
      sections.push(
        `## Proactive Internal Context\n${input.proactiveEvidence.trim()}`,
      );
    }
    return fitWholeSections(sections, 8_000);
  }

}

const fitWholeSections = (sections: string[], maxLength: number): string => {
  const priority = (section: string): number => {
    if (section.startsWith("# Request Context")) return 0;
    if (section.startsWith("## Conversation Focus")) return 1;
    if (section.startsWith("## Proactive Internal Context")) return 2;
    return 6;
  };
  const accepted: string[] = [];
  let length = 0;
  for (const section of [...sections].sort((a, b) => priority(a) - priority(b))) {
    const addedLength = section.length + (accepted.length > 0 ? 2 : 0);
    if (accepted.length > 0 && length + addedLength > maxLength) continue;
    accepted.push(section);
    length += addedLength;
  }
  return accepted.join("\n\n");
};



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
