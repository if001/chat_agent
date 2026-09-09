import {
  DailyEventRepository,
  UserMemoryStore,
} from "../../core/types";
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
    private readonly userMemoryStore: UserMemoryStore,
    private readonly dailyEventRepository: DailyEventRepository,
    private readonly policyContextReader: PolicyContextReader,
    private readonly now: () => Date = () => new Date(),
    private readonly conversationAnalysisService?: ConversationAnalysisService,
    private readonly knowledgeContextReader?: KnowledgeContextReader,
  ) {}

  async build(input: RequestContextInput): Promise<string> {
    const analysisService = this.conversationAnalysisService;
    const hasPrecomputedFocus = "conversationFocus" in input;
    const shouldLoadEvents = needsDailyEventContext(input.currentContext);
    const shouldLoadKnowledge = needsKnowledgeContext(input.currentContext);
    const [notes, events, policy, focus, knowledge] = await Promise.all([
      loadOrDefault(
        () =>
          this.userMemoryStore.searchUserNotes(
            input.userId,
            compactQuery(input.currentContext),
            5,
          ),
        [],
      ),
      shouldLoadEvents ? loadOrDefault(
        () =>
          this.dailyEventRepository.searchDailyEvents({
            userId: input.userId,
            query: compactQuery(input.currentContext),
            limit: 5,
          }),
        [],
      ) : Promise.resolve([]),
      loadOrDefault(
        () =>
          this.policyContextReader.load({
            botId: input.botId,
            threadId: input.threadId,
            currentContext: input.currentContext,
          }),
        undefined,
      ),
      hasPrecomputedFocus
        ? input.conversationFocus ?? null
        : analysisService
        ? loadOrDefault(
            () =>
              analysisService.analyze({
                botId: input.botId,
                threadId: input.threadId,
                currentContext: input.currentContext,
              }).then(({ focus }) => focus),
            null,
          )
        : null,
      shouldLoadKnowledge && this.knowledgeContextReader
        ? loadWithStatus(
            () =>
              this.knowledgeContextReader!.searchRelevant({
                query: buildKnowledgeQuery(input.currentContext, input.conversationFocus),
                limit: 3,
              }),
            [] as KnowledgeContextItem[],
          )
        : Promise.resolve({ value: [] as KnowledgeContextItem[], failed: false }),
    ]);

    const sections = [`# Request Context\nCurrent time: ${this.now().toISOString()}`];
    if (notes.length > 0) {
      sections.push(
        `## Shared UserMemory\n${notes.map((item) => `- ${compact(item.note, 400)}`).join("\n")}`,
      );
    }
    if (events.length > 0) {
      sections.push(
        `## Shared DailyEvent\n${events
          .map((item) => `- ${item.eventDate}: ${compact(item.summary, 400)}`)
          .join("\n")}`,
      );
    }
    if (policy?.trim()) {
      sections.push(`## Bot-specific PolicyCard\n${compact(policy, 1_800)}`);
    }
    if (knowledge.value.length > 0) {
      sections.push(
        `## Relevant Shared Articles\n${knowledge.value
          .slice(0, 3)
          .map(
            (item) =>
              `- articleId=${item.articleId}; title=${compact(item.title, 160)}; summary=${compact(item.summary, 500)}; tags=${item.tags.slice(0, 8).join(", ")}; url=${item.url}`,
          )
          .join("\n")}`,
      );
    } else if (shouldLoadKnowledge && knowledge.failed) {
      sections.push(
        "## Shared Article Retrieval\nRelevant saved articles could not be checked for this request.",
      );
    }
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

const compactQuery = (value: string): string => compact(value, 500);

const compact = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
};

const fitWholeSections = (sections: string[], maxLength: number): string => {
  const priority = (section: string): number => {
    if (section.startsWith("# Request Context")) return 0;
    if (section.startsWith("## Conversation Focus")) return 1;
    if (section.startsWith("## Proactive Internal Context")) return 2;
    if (section.startsWith("## Bot-specific PolicyCard")) return 3;
    if (section.startsWith("## Relevant Shared Articles")) return 4;
    if (section.startsWith("## Shared UserMemory")) return 5;
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

const buildKnowledgeQuery = (
  currentContext: string,
  focus?: ConversationFocus | null,
): string =>
  compact(
    [currentContext, focus?.currentTopic]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n"),
    700,
  );

const needsDailyEventContext = (value: string): boolean =>
  /(昨日|今日|明日|先週|今週|先月|今月|以前|前回|いつ|何日|予定|出来事|やった|行った|したこと|覚えて|戻って|続き)/u.test(
    value,
  ) || /\b\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?\b/u.test(value);

const needsKnowledgeContext = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, "").trim();
  if (normalized.length < 8) {
    return false;
  }
  if (/^(ありがとう|了解|わかった|はい|いいえ|おはよう|こんにちは|こんばんは)[！!。.]?$/u.test(normalized)) {
    return false;
  }
  return /[?？]|(記事|ニュース|URL|リンク|共有|保存|読ん|内容|要約|について|とは|なぜ|どう|教えて|調べ|比較|根拠|情報)/u.test(
    value,
  );
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

const loadWithStatus = async <T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; failed: boolean }> => {
  try {
    return { value: await load(), failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
};
