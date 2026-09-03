import { TurnRecord } from "@chat-agent/memory-system";
import {
  CONVERSATION_FOCUS_MAX_CHARS,
  createConversationAnalysisService,
  formatConversationFocus,
} from "./conversationFocus";

const turn = (
  user: string,
  assistant: string,
  kind: TurnRecord["kind"] = "human",
  index: number = 0,
): TurnRecord => ({
  botId: "ao",
  threadId: "thread-1",
  kind,
  messages: [
    {
      role: "user",
      content: user,
      timestampIso: `2026-09-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
    },
    {
      role: "assistant",
      content: assistant,
      timestampIso: `2026-09-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
    },
  ],
  createdAtIso: `2026-09-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
});

test("recognizes a question without question-mark punctuation", async () => {
  const fixture = createFixture([
    turn("CIの失敗を調べたい", "ログを確認します"),
  ], {
    currentTopic: "CIの失敗原因",
    currentTopicReason: "the user is discussing the CI failure",
    unresolvedQuestion: "CIが失敗する理由を教えて",
    unresolvedQuestionReason: "the user asks for the cause without punctuation",
    currentTopicStatus: "active",
    currentTopicStatusReason: "the requested explanation is unresolved",
    reason: "user is asking for an unresolved explanation",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "the technical question is active focus",
  });

  const result = await fixture.service.analyze(input("CIが失敗する理由を教えて"));

  expect(result.focus).toMatchObject({
    unresolvedQuestion: "CIが失敗する理由を教えて",
    unresolvedQuestionReason: "the user asks for the cause without punctuation",
    currentTopicStatus: "active",
  });
  expect(fixture.calls).toHaveLength(1);
});

test("recognizes an implicit agent commitment", async () => {
  const fixture = createFixture(
    [turn("設定を見てほしい", "ログまで追って結果を持ってきます")],
    {
      currentTopic: "設定調査",
      currentTopicReason: "the user asked for a settings investigation",
      agentCommitment: "ログまで追って結果を持ってくる",
      agentCommitmentReason: "the assistant implicitly promised to return with results",
      currentTopicStatus: "active",
      currentTopicStatusReason: "the promised investigation is still pending",
      reason: "assistant implicitly promised a later result",
      conversationTrigger: "ineligible",
      conversationTriggerReason: "work is still in progress",
    },
  );

  const result = await fixture.service.analyze(input("進捗を待っています"));

  expect(result.focus?.agentCommitment).toContain("結果を持ってくる");
  expect(result.focus?.agentCommitmentReason).toContain("implicitly promised");
});

test("recognizes paraphrased completion", async () => {
  const fixture = createFixture(
    [turn("CIを直したい", "原因を確認します")],
    {
      currentTopicStatus: "complete",
      currentTopicStatusReason: "the user says the topic can be closed",
      reason: "the user says no further work is necessary",
      conversationTrigger: "eligible",
      conversationTriggerReason: "the prior topic is complete",
    },
  );

  const result = await fixture.service.analyze(
    input("必要なところまで片付いたので、ここで区切れます"),
  );

  expect(result.focus).toEqual({
    currentTopicStatus: "complete",
    currentTopicStatusReason: "the user says the topic can be closed",
  });
});

test("separates current and resumable topics and handles a return", async () => {
  const fixture = createFixture(
    [
      turn("認証設計を進めたい", "選択肢を整理します"),
      turn("CIの失敗も見て", "まずCIログを確認します", "human", 1),
    ],
    {
      currentTopic: "認証設計",
      currentTopicReason: "the user explicitly returned to authentication design",
      resumableTopic: "CIの失敗調査",
      resumableTopicReason: "the CI investigation was interrupted by the return",
      currentTopicStatus: "active",
      currentTopicStatusReason: "authentication design is active again",
      reason: "the user returned to the earlier authentication topic",
      conversationTrigger: "ineligible",
      conversationTriggerReason: "the returned topic is active",
    },
  );

  const result = await fixture.service.analyze(
    input("認証設計の続きに戻って進めよう"),
  );

  expect(result.focus).toMatchObject({
    currentTopic: "認証設計",
    resumableTopic: "CIの失敗調査",
  });
});

test("excludes proactive and delegation instructions from analyzer input", async () => {
  const fixture = createFixture(
    [
      turn("visible human topic", "visible answer"),
      turn("internal proactive instruction", "proactive output", "proactive", 1),
      turn("internal delegation instruction", "delegated output", "delegation", 2),
    ],
    {
      currentTopic: "visible human topic",
      currentTopicReason: "the human history names this topic",
      currentTopicStatus: "active",
      currentTopicStatusReason: "the visible human topic is ongoing",
      reason: "visible human history only",
      conversationTrigger: "ineligible",
      conversationTriggerReason: "the visible topic is active",
    },
  );

  await fixture.service.analyze(input("continue visible topic"));

  expect(fixture.calls[0]).toContain("visible human topic");
  expect(fixture.calls[0]).not.toContain("internal proactive|internal delegation");
  expect(fixture.calls[0]).not.toContain("internal proactive instruction");
  expect(fixture.calls[0]).not.toContain("internal delegation instruction");
});

test("enforces history limits and calls the analyzer at most once", async () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    turn(`user-${index}-${"x".repeat(500)}`, `assistant-${index}-${"y".repeat(500)}`, "human", index),
  );
  const fixture = createFixture(
    records,
    {
      currentTopic: "bounded",
      currentTopicReason: "the bounded history supports it",
      currentTopicStatus: "active",
      currentTopicStatusReason: "the bounded topic is active",
      reason: "bounded input",
      conversationTrigger: "ineligible",
      conversationTriggerReason: "bounded fixture",
    },
    { historyLimit: 4, maxItemLength: 80, maxHistoryChars: 240 },
  );

  await fixture.service.analyze(input("latest"));

  expect(fixture.readerCalls).toEqual([
    { botId: "ao", threadId: "thread-1", limit: 4 },
  ]);
  expect(fixture.calls).toHaveLength(1);
  const parsed = JSON.parse(fixture.calls[0] ?? "{}") as {
    humanConversationHistory: string[];
  };
  expect(parsed.humanConversationHistory.join("").length).toBeLessThanOrEqual(240);
  expect(parsed.humanConversationHistory.every((item) => item.length <= 80)).toBe(true);
});

test("handles empty input and no history deterministically", async () => {
  const empty = createFixture([], null);
  expect(await empty.service.analyze(input("   "))).toEqual({
    focus: null,
    reason: "current input is empty",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "current input is empty",
  });
  expect(empty.calls).toHaveLength(0);

  const noHistory = createFixture([], null);
  expect(await noHistory.service.analyze(input("first topic"))).toMatchObject({
    focus: {
      currentTopic: "first topic",
      currentTopicReason: "the first request establishes this topic",
      currentTopicStatus: "active",
      currentTopicStatusReason: "the first request is still active",
    },
  });
  expect(noHistory.calls).toHaveLength(0);
});

test("falls back to no focus for invalid analyzer output", async () => {
  const fixture = createFixture(
    [turn("topic", "answer")],
    { currentTopicStatus: "unexpected" },
  );

  await expect(fixture.service.analyze(input("continue"))).resolves.toEqual({
    focus: null,
    reason: "invalid conversation analysis output",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "invalid conversation analysis output",
  });
});

test("omits incomplete focus value-reason pairs", async () => {
  const fixture = createFixture([turn("topic", "answer")], {
    currentTopic: "value without reason",
    unresolvedQuestionReason: "reason without value",
    currentTopicStatus: "active",
    currentTopicStatusReason: "the conversation is active",
    reason: "valid overall analysis",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "the conversation is active",
  });

  const result = await fixture.service.analyze(input("continue"));
  const formatted = formatConversationFocus(result.focus);

  expect(result.focus).toEqual({
    currentTopicStatus: "active",
    currentTopicStatusReason: "the conversation is active",
  });
  expect(formatted).not.toContain("value without reason");
  expect(formatted).not.toContain("reason without value");
});

test("rejects a status without its reason", async () => {
  const fixture = createFixture([turn("topic", "answer")], {
    currentTopicStatus: "active",
    reason: "missing status reason",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "the conversation is active",
  });

  await expect(fixture.service.analyze(input("continue"))).resolves.toEqual({
    focus: null,
    reason: "invalid conversation analysis output",
    conversationTrigger: "ineligible",
    conversationTriggerReason: "invalid conversation analysis output",
  });
});

test("keeps a technical error-handling question semantically eligible when focus permits", async () => {
  const fixture = createFixture(
    [turn("前の話題は完了", "了解しました")],
    {
      currentTopic: "エラー処理の設計",
      currentTopicReason: "the user asks about error-handling design",
      currentTopicStatus: "complete",
      currentTopicStatusReason: "the current reply can conclude the explanation",
      reason: "the current reply can conclude the technical explanation",
      conversationTrigger: "eligible",
      conversationTriggerReason:
        "error is the technical subject, not an incident report",
    },
  );

  const result = await fixture.service.analyze(
    input("エラー処理の設計パターンを教えて"),
  );

  expect(result.conversationTrigger).toBe("eligible");
  expect(result.conversationTriggerReason).toContain("technical subject");
  expect(fixture.calls).toHaveLength(1);
});

test.each([
  ["そこではなく前提を訂正したい", "correction is in progress"],
  ["結果を確認しているところです", "work is still in progress"],
  ["その理解で合っています", "short semantic acknowledgement"],
] as const)(
  "marks semantic interruption as ineligible: %s",
  async (currentContext, triggerReason) => {
    const fixture = createFixture([turn("topic", "answer")], {
      currentTopic: "topic",
      currentTopicReason: "the conversation remains on the same topic",
      currentTopicStatus: "active",
      currentTopicStatusReason: "the semantic interruption keeps it active",
      reason: "the current topic remains active",
      conversationTrigger: "ineligible",
      conversationTriggerReason: triggerReason,
    });

    const result = await fixture.service.analyze(input(currentContext));

    expect(result.conversationTrigger).toBe("ineligible");
    expect(result.conversationTriggerReason).toBe(triggerReason);
    expect(fixture.calls).toHaveLength(1);
  },
);

test("bounds formatted focus output", () => {
  const formatted = formatConversationFocus({
    currentTopic: "a".repeat(2_000),
    currentTopicReason: "e".repeat(2_000),
    unresolvedQuestion: "b".repeat(2_000),
    unresolvedQuestionReason: "f".repeat(2_000),
    agentCommitment: "c".repeat(2_000),
    agentCommitmentReason: "g".repeat(2_000),
    resumableTopic: "d".repeat(2_000),
    resumableTopicReason: "h".repeat(2_000),
    currentTopicStatus: "active",
    currentTopicStatusReason: "i".repeat(2_000),
  });
  expect(formatted?.length).toBeLessThanOrEqual(CONVERSATION_FOCUS_MAX_CHARS);
});

const input = (currentContext: string) => ({
  botId: "ao",
  threadId: "thread-1",
  currentContext,
});

const createFixture = (
  records: TurnRecord[],
  output: unknown,
  limits: {
    historyLimit?: number;
    maxItemLength?: number;
    maxHistoryChars?: number;
  } = {},
) => {
  const calls: string[] = [];
  const readerCalls: unknown[] = [];
  const service = createConversationAnalysisService({
    reader: {
      listRecentTurnRecords: async (readerInput) => {
        readerCalls.push(readerInput);
        return records;
      },
    },
    model: {
      generateJson: async <T>(_systemPrompt: string, userPrompt: string) => {
        calls.push(userPrompt);
        return output as T;
      },
    },
    ...limits,
  });
  return { service, calls, readerCalls };
};
