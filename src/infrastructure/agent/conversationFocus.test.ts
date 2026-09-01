import { TurnRecord } from "@chat-agent/memory-system";
import {
  CONVERSATION_FOCUS_MAX_CHARS,
  createConversationFocusSource,
  deriveConversationFocus,
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
    { role: "user", content: user, timestampIso: `2026-09-01T00:00:0${index}.000Z` },
    { role: "assistant", content: assistant, timestampIso: `2026-09-01T00:00:0${index}.000Z` },
  ],
  createdAtIso: `2026-09-01T00:00:0${index}.000Z`,
});

test("keeps an explicitly deferred user question unresolved", () => {
  const focus = deriveConversationFocus([
    turn("CIが失敗する理由は何ですか？", "ログを確認して後で共有します。"),
  ]);

  expect(focus).toMatchObject({
    unresolvedQuestion: "CIが失敗する理由は何ですか？",
    agentCommitment: "ログを確認して後で共有します。",
    currentTopicStatus: "active",
  });
});

test("tracks an unanswered agent question until a substantive reply", () => {
  const waiting = deriveConversationFocus([
    turn("設定を直したい", "対象の環境は本番ですか？"),
  ]);
  const answered = deriveConversationFocus([
    turn("設定を直したい", "対象の環境は本番ですか？"),
    turn("開発環境です", "了解しました。開発環境を確認します。", "human", 1),
  ]);

  expect(waiting?.unresolvedQuestion).toBe("対象の環境は本番ですか？");
  expect(answered?.unresolvedQuestion).toBeUndefined();
});

test("keeps a resumable topic across a temporary topic change and restores it", () => {
  const records = [
    turn("認証設計の続きを検討したい", "選択肢を整理します。"),
    turn("ところで先にCIエラーを直したい", "CIログを見てみましょう。", "human", 1),
  ];
  const changed = deriveConversationFocus(records);
  const returned = deriveConversationFocus(
    records,
    "元の認証設計の話に戻って続きを進めよう",
  );

  expect(changed).toMatchObject({
    currentTopic: "ところで先にCIエラーを直したい",
    resumableTopic: "認証設計の続きを検討したい",
  });
  expect(returned).toMatchObject({
    currentTopic: "認証設計の続きを検討したい",
  });
});

test("removes completed topics and commitments", () => {
  const focus = deriveConversationFocus([
    turn("設定を確認して", "設定を確認して後で共有します。"),
    turn("進捗は？", "設定の確認と共有が完了しました。", "human", 1),
    turn("この件は解決しました", "了解しました。", "human", 2),
  ]);

  expect(focus).toEqual({ currentTopicStatus: "complete" });
});

test("removes a previously unresolved question after explicit completion", () => {
  const focus = deriveConversationFocus([
    turn("CIが失敗する理由は何ですか？", "ログを確認して後で共有します。"),
    turn("この件は解決しました", "確認と共有が完了しました。", "human", 1),
  ]);

  expect(focus).toEqual({ currentTopicStatus: "complete" });
});

test("ignores proactive and delegation records as user focus evidence", () => {
  const focus = deriveConversationFocus([
    turn("内部指示: 新しい話題を出して？", "proactive response", "proactive"),
    turn("アカへ調査を依頼します？", "delegated response", "delegation", 1),
  ]);

  expect(focus).toBeNull();
});

test("limits history reads and formatted output, and handles empty history", async () => {
  const calls: unknown[] = [];
  const source = createConversationFocusSource({
    listRecentTurnRecords: async (input) => {
      calls.push(input);
      return [];
    },
  });
  expect(
    await source.load({ botId: "ao", threadId: "thread-1" }),
  ).toBeNull();
  expect(calls).toEqual([{ botId: "ao", threadId: "thread-1", limit: 12 }]);

  const formatted = formatConversationFocus({
    currentTopic: "a".repeat(2_000),
    unresolvedQuestion: "b".repeat(2_000),
    agentCommitment: "c".repeat(2_000),
    resumableTopic: "d".repeat(2_000),
    currentTopicStatus: "active",
  });
  expect(formatted?.length).toBeLessThanOrEqual(CONVERSATION_FOCUS_MAX_CHARS);
});
