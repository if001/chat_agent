import { TurnRecord } from "@chat-agent/memory-system";

const turn = (
  createdAtIso: string,
  kind: TurnRecord["kind"],
  user: string,
  assistant: string,
  sourceInteractionId?: string,
  botId: string = "ao",
): TurnRecord => ({
  botId,
  threadId: "shared-thread",
  kind,
  ...(sourceInteractionId ? { sourceInteractionId } : {}),
  createdAtIso,
  messages: [
    { role: "user", content: user, timestampIso: createdAtIso },
    { role: "assistant", content: assistant, timestampIso: createdAtIso },
  ],
});

export const longConversationFixture: TurnRecord[] = [
  turn(
    "2026-08-30T09:00:00.000Z",
    "human",
    "CIが失敗する理由は何ですか？",
    "ログを確認して後で共有します。",
  ),
  turn(
    "2026-08-30T09:05:00.000Z",
    "human",
    "ところで先に昨日のリリース日時を確認したい",
    "昨日の記録は2026-08-30のリリースです。",
  ),
  turn(
    "2026-08-30T10:00:00.000Z",
    "proactive",
    "background内部指示: テストの話題を出す",
    "property testingの小さな事例を共有します。",
    "pomdp_123e4567-e89b-42d3-a456-426614174000",
  ),
  turn(
    "2026-08-30T10:02:00.000Z",
    "human",
    "そのテストの話は興味があります",
    "次は具体例を整理します。",
    "pomdp_123e4567-e89b-42d3-a456-426614174000",
  ),
  turn(
    "2026-08-30T10:10:00.000Z",
    "delegation",
    "<@aka> CIログの原因を調査してください",
    "<@ao> キャッシュ設定が原因です。",
    undefined,
    "aka",
  ),
  turn(
    "2026-09-01T08:00:00.000Z",
    "human",
    "以前の『簡潔な回答を好む』は違います。詳しい回答を好みます",
    "既存の記憶を訂正します。",
  ),
];

export const completedConversationTurn = turn(
  "2026-09-01T09:00:00.000Z",
  "human",
  "この件は解決しました",
  "CIログの確認と共有が完了しました。",
);
