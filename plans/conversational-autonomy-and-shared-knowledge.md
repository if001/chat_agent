# 会話主体型agent・共有記事活用・LLMコンテキスト最適化計画

## 目的

1人のユーザーと継続的に関わる会話主体型agentとして、自発的話題提供、予定実行、会話継続、記憶利用、古い応答の破棄、安全な失敗回復を成立させる。汎用的な長期タスクagentや自己改変基盤は対象にしない。

## 共有記事

- 別の要約bot、ao、akaは共通Postgresの`articles`と`KnowledgeRepository`を利用する。
- 記事をbot別に分離せず、保存元に関係なくao/akaの両方から検索できる。
- URLを一意キーとして再投入時は同じ記事を更新する。
- 通常requestでは必要性を判定して上位3件のID、title、summary、tags、URLだけを注入する。
- contentは必要な記事だけtoolで取得し、raw markdownは明示的な原文確認時だけ取得する。
- proactive plannerも同じ保存記事を候補sourceとして使用する。
- embeddingにはtitle、summary、要点化content、tagsを使い、raw markdownは含めない。

## Contextとprompt

- UserMemoryはrequest本文による関連検索を最大5件にする。
- DailyEventは日付、過去、予定、会話復帰に関係するrequestだけ最大5件取得する。
- PolicyCardはrequestごとに適用候補だけを取得する。
- 保存記事は独立sectionにし、UserMemoryやDailyEventへ複製しない。
- plannerのrecent turns取得を1回にし、TopicStateとInteractionLogの重複表現を削る。
- 記事検索score、raw markdown、全文debug prompt、ユーザー反応本文を通常のLLM payloadやlogへ出さない。
- DailyEventと保存記事はao/aka共有、checkpoint・PolicyCard・TopicStateはbot別とする。

## Queueと失敗回復

- conversationVersionで古い応答を破棄し、後続入力を1つの最新taskへまとめる。
- sourceInteractionIdを冪等キーとして、複数processからのproactive enqueueを重複させない。
- file queue更新をprocess間lockとatomic renameで保護する。
- worker失敗回数と最終理由を永続化し、一時失敗を再試行した後は失敗taskとして残す。
- 古いprocess lockとtask leaseは時間経過後に回収する。

## 完了条件

- 要約botが保存した同じ記事をao/akaが検索できる。
- 無関係な会話で記事・DailyEventを検索せず、関連質問では軽量候補だけを注入する。
- proactiveの話題と根拠記事をInteractionLogから追跡できる。
- 同時enqueue、worker再起動、追加入力で重複発話や古い応答を送らない。
- build、root test、全package testがNode 23以上で成功する。
