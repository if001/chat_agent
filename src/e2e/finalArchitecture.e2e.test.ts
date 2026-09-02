import { KnowledgeAccessService } from "@chat-agent/knowledge-access";
import {
  DailyEvent,
  DailyEventRepository,
  UserMemoryStore,
  UserNote,
} from "../core/types";
import {
  createConversationAnalysisService,
} from "../infrastructure/agent/conversationFocus";
import { createCustomTools } from "../infrastructure/agent/customTools";
import { DeepAgentRuntime } from "../infrastructure/agent/deepAgentRuntime";
import { RequestContextBuilder } from "../infrastructure/agent/requestContextBuilder";
import { loadSystemPromptByBotId } from "../config/systemPromptLoader";
import {
  completedConversationTurn,
  longConversationFixture,
} from "./fixtures/longConversation";

class FixtureUserMemoryStore implements UserMemoryStore {
  private notes: UserNote[] = [
    {
      id: 1,
      note: "簡潔な回答を好む",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  ];

  async rememberUserNote(_userId: string, note: string): Promise<UserNote> {
    const saved = { id: this.notes.length + 1, note, createdAt: new Date() };
    this.notes.push(saved);
    return saved;
  }

  async searchUserNotes(
    _userId: string,
    query: string,
    limit: number,
  ): Promise<UserNote[]> {
    return this.notes
      .filter((item) => !query || item.note.includes(query))
      .slice(0, limit);
  }

  async replaceUserNote(
    _userId: string,
    noteId: number,
    note: string,
  ): Promise<UserNote | null> {
    const index = this.notes.findIndex((item) => item.id === noteId);
    if (index < 0) {
      return null;
    }
    const saved = { ...this.notes[index]!, note };
    this.notes[index] = saved;
    return saved;
  }

  async deleteUserNote(_userId: string, noteId: number): Promise<boolean> {
    const previousLength = this.notes.length;
    this.notes = this.notes.filter((item) => item.id !== noteId);
    return this.notes.length < previousLength;
  }
}

class FixtureDailyEvents implements DailyEventRepository {
  private readonly events: DailyEvent[] = [
    {
      id: 1,
      botId: "shared",
      userId: "user-1",
      eventDate: "2026-08-30",
      summary: "release 1.0を公開した",
      tags: ["release"],
      createdAt: new Date("2026-08-30T12:00:00.000Z"),
    },
    {
      id: 2,
      botId: "shared",
      userId: "user-1",
      eventDate: "2026-09-01",
      summary: "CIの原因調査を再開した",
      tags: ["ci"],
      createdAt: new Date("2026-09-01T08:00:00.000Z"),
    },
  ];

  async rememberDailyEvent(): Promise<DailyEvent> {
    throw new Error("not used by this read fixture");
  }

  async searchDailyEvents(): Promise<DailyEvent[]> {
    return [...this.events].sort((left, right) =>
      right.eventDate.localeCompare(left.eventDate),
    );
  }

  async getDailyEventsByDate(): Promise<DailyEvent[]> {
    return this.events;
  }
}

const knowledgeAccessService = {
  searchSavedKnowledge: async () => [],
  getSavedArticle: async () => null,
  webList: async () => [],
  webPage: async ({ url }: { url: string }) => ({
    url,
    title: "fixture",
    markdown: "fixture",
  }),
  saveWebKnowledge: async ({ url }: { url: string }) => ({
    articleId: "fixture-1",
    title: "fixture",
    summary: "fixture",
    url,
  }),
} as KnowledgeAccessService;

const findTool = (
  tools: Array<{ name: string; invoke(input: unknown): Promise<unknown> }>,
  name: string,
) => {
  const selected = tools.find((candidate) => candidate.name === name);
  if (!selected) {
    throw new Error(`missing fixture tool: ${name}`);
  }
  return selected;
};

test("fixed long conversation preserves corrections, chronology, focus, and bot scope", async () => {
  const userMemoryStore = new FixtureUserMemoryStore();
  const dailyEventRepository = new FixtureDailyEvents();
  const tools = createCustomTools({
    knowledgeAccessService,
    userMemoryStore,
    userMemoryWritePlanner: {
      decide: async ({ explicitTargetNoteId }) => ({
        action: "replace" as const,
        targetNoteId: explicitTargetNoteId as number,
        reason: "fixture correction",
      }),
    },
    dailyEventRepository,
    botId: "ao",
    runtimeContext: {
      current: () => ({
        botId: "ao",
        userId: "user-1",
        threadId: "shared-thread",
      }),
    },
  });

  const searched = JSON.parse(
    (await findTool(tools, "search_user_notes").invoke({ query: "簡潔" })) as string,
  ) as UserNote[];
  expect(searched).toHaveLength(1);
  await findTool(tools, "replace_user_note").invoke({
    noteId: searched[0]?.id,
    note: "詳しい回答を好む",
  });

  const createFixtureAnalysis = (includeCompleted: boolean = false) =>
    createConversationAnalysisService({
      reader: {
        listRecentTurnRecords: async ({ botId, threadId, limit }) =>
          [
            ...longConversationFixture,
            ...(includeCompleted ? [completedConversationTurn] : []),
          ]
            .filter(
              (record) =>
                record.botId === botId && record.threadId === threadId,
            )
            .slice(-limit),
      },
      model: {
        generateJson: async <T>(_systemPrompt: string, userPrompt: string) =>
          (userPrompt.includes("この件は解決しました")
            ? {
                currentTopicStatus: "complete",
                reason: "fixture topic was completed",
              }
            : {
                currentTopic: "CIが失敗する理由は何ですか？",
                unresolvedQuestion: "CIが失敗する理由は何ですか？",
                agentCommitment: "ログを確認して後で共有します。",
                currentTopicStatus: "active",
                reason: "fixture returned to unresolved CI investigation",
              }) as T,
      },
    });
  const conversationAnalysisService = createFixtureAnalysis();
  const policyInputs: string[] = [];
  const builder = new RequestContextBuilder(
    userMemoryStore,
    dailyEventRepository,
    {
      load: async ({ botId }) => {
        policyInputs.push(botId);
        return `${botId}-only policy`;
      },
    },
    () => new Date("2026-09-01T09:00:00.000Z"),
    conversationAnalysisService,
  );
  const build = (botId: string) =>
    builder.build({
      botId,
      userId: "user-1",
      threadId: "shared-thread",
      currentContext: "元のCIの話に戻って続きを進めよう",
      kind: "human",
    });
  const [aoContext, akaContext] = await Promise.all([build("ao"), build("aka")]);

  expect(aoContext).toContain("詳しい回答を好む");
  expect(akaContext).toContain("詳しい回答を好む");
  expect(aoContext).not.toContain("簡潔な回答を好む");
  expect(aoContext.indexOf("CIの原因調査を再開した")).toBeLessThan(
    aoContext.indexOf("release 1.0を公開した"),
  );
  expect(aoContext).toContain("ao-only policy");
  expect(aoContext).not.toContain("aka-only policy");
  expect(akaContext).toContain("aka-only policy");
  expect(akaContext).not.toContain("ao-only policy");
  expect(policyInputs.sort()).toEqual(["aka", "ao"]);

  const focus = await conversationAnalysisService.analyze({
    botId: "ao",
    threadId: "shared-thread",
    currentContext: "元のCIの話に戻って続きを進めよう",
  });
  expect(focus.focus).toMatchObject({
    currentTopic: "CIが失敗する理由は何ですか？",
    unresolvedQuestion: "CIが失敗する理由は何ですか？",
    agentCommitment: "ログを確認して後で共有します。",
    currentTopicStatus: "active",
  });
  const acknowledged = await conversationAnalysisService.analyze({
    botId: "ao",
    threadId: "shared-thread",
    currentContext: "了解",
  });
  expect(acknowledged.focus?.currentTopic).not.toBe("了解");
  expect(acknowledged.focus?.currentTopicStatus).toBe("active");
  expect(
    (
      await createFixtureAnalysis(true).analyze({
        botId: "ao",
        threadId: "shared-thread",
        currentContext: "ここで区切ります",
      })
    ).focus,
  ).toEqual({ currentTopicStatus: "complete" });

  const proactive = longConversationFixture.find(
    (record) => record.kind === "proactive",
  );
  const reaction = longConversationFixture.find(
    (record) =>
      record.kind === "human" &&
      record.sourceInteractionId === proactive?.sourceInteractionId,
  );
  expect(proactive?.sourceInteractionId).toBe("interaction-testing-1");
  expect(reaction?.sourceInteractionId).toBe(proactive?.sourceInteractionId);
  expect(longConversationFixture.some((record) => record.kind === "delegation")).toBe(
    true,
  );

  const aoPrompt = loadSystemPromptByBotId("ao", "fallback");
  const akaPrompt = loadSystemPromptByBotId("aka", "fallback");
  expect(aoPrompt).toContain("アオ");
  expect(aoPrompt).toContain("アカ");
  expect(akaPrompt).toContain("アカ");
  expect(akaPrompt).toContain("アオ");
  expect(aoPrompt).not.toBe(akaPrompt);

  const createdPrompts: string[] = [];
  const checkpointThreads: string[] = [];
  const invocationContexts: string[] = [];
  const runtime = new DeepAgentRuntime(
    {},
    [],
    ({ systemPrompt }) => {
      createdPrompts.push(systemPrompt);
      return {
        invoke: async (input, config) => {
          checkpointThreads.push(config.configurable.thread_id);
          invocationContexts.push(input.messages[0]?.content ?? "");
          return { messages: [{ role: "assistant", content: "fixture reply" }] };
        },
      };
    },
    () => undefined,
    () => undefined,
  );
  await runtime.respond({
    botId: "ao",
    userId: "user-1",
    systemPrompt: aoPrompt,
    requestContext: aoContext,
    threadId: "shared-thread",
    messages: [{ role: "user", content: "アカに調査を依頼して" }],
  });
  await runtime.respond({
    botId: "aka",
    userId: "user-1",
    systemPrompt: akaPrompt,
    requestContext: akaContext,
    threadId: "shared-thread",
    messages: [{ role: "user", content: "アオからの調査依頼" }],
  });

  expect(createdPrompts).toEqual([aoPrompt, akaPrompt]);
  expect(checkpointThreads).toEqual([
    "ao:shared-thread",
    "aka:shared-thread",
  ]);
  expect(invocationContexts[0]).toContain("ao-only policy");
  expect(invocationContexts[0]).not.toContain("aka-only policy");
  expect(invocationContexts[1]).toContain("aka-only policy");
  expect(invocationContexts[1]).not.toContain("ao-only policy");
});
