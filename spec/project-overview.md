# Chat Agent の構成と責務

## プロジェクトの概要

本プロジェクトは、所有者本人がローカルで運用し、一人のユーザーと長期的に対話する Discord 向け Agent である。
通常会話を担う `ao` と技術対話を担う `aka` が、共有のユーザー記憶と知識を使いながら、必要に応じて相互に協力する。
会話履歴、応答方針、自発的な話題選択を別の責務として分け、同じユーザー像を複数箇所で重複管理しない設計を採る。

## Response Agent（`src/`）

`src/` は、Discord またはターミナルからの入力を受け、DeepAgent による応答生成と各パッケージの組み立てを担うアプリケーション層である。
`ao` は通常会話、`aka` は技術的な相談を担当し、人格と短期実行状態、経験由来の PolicyCard は `botId` ごとに分離する。
リクエストごとの動的文脈は静的な system prompt と分け、記憶、知識、予定登録は信頼済みの実行文脈からユーザーとスレッドを特定する tool 経由で利用する。

## 会話の受付と実行（`src/ui`、`src/core`、`src/infrastructure`）

Discord の入力と自発発話の内部指示は同じ queue に集約し、`conversationVersion` が古い応答を送信前に破棄する。
DeepAgent の checkpoint は Agent ごとの短期状態と処理再開に限定し、ユーザーに見える会話は `TurnRecord` として一度だけ保存する。
通常応答、自発話、Agent 間委譲を `human`、`proactive`、`delegation` に分類し、内部指示をユーザー発言として学習しないようにする。

## `packages/memory-system`

`memory-system` は、永続会話履歴の正本である `TurnRecord` と、ユーザーに関する `UserMemory`、日付付きの `DailyEvent` を管理する。
会話から Episode を抽出し、類似状況での応答方法を表す bot 別の PolicyCard を構築、検索することで procedural memory を提供する。
PostgreSQL の repository を中心に据え、明示的な記憶の追加、検索、置換、削除と、バックグラウンドでの候補抽出を一つのサービス境界にまとめる。

## `packages/simple-pomdp-system`

`simple-pomdp-system` は、自発的に「今どの話題をどう投げるか」を決める initiative planner である。
直近会話、UserMemory、保存済み知識、話題への反応を読み、`explore`、`refine`、`exploit` のいずれかを選んで通常応答への統合指示または scheduled 発話を生成する。
自身が永続化する情報は bot 別の `TopicState` と `InteractionLog` に限定し、会話履歴は `memory-system` から読み取って複製しない。

## `packages/knowledge-access`

`knowledge-access` は、Agent と自発話 planner が共有する Web 取得および保存済み知識へのアクセス機能を提供する。
検索結果とページ本文の取得、LLM による記事の要約とタグ付け、PostgreSQL と pgvector を使った保存と意味検索を担う。
話題選択や会話制御は行わず、Web client、分析 model、repository を interface として分離した下位サービスに徹する。

## `packages/queue`

`queue` は、ユーザーの mention、単発または反復する予定、自発話の内部指示を同じタスク形式で順序付ける。
同一スレッドへの連続入力をまとめ、ロック、再試行、定期タスクの再登録、`sourceInteractionId` による重複防止をファイル永続化で実現する。
スレッドごとの `conversationVersion` を単調増加させ、処理中に新しい入力が届いた場合も古い文脈の応答が配信されない境界を作る。

## 依存関係とデータの所有

`src/` の Response Agent が四つのパッケージを組み立て、各パッケージ同士の連携は公開 API と小さな読み取り interface を介して行う。
UserMemory、DailyEvent、knowledge は `ao` と `aka` で共有し、checkpoint、Episode、PolicyCard、TopicState、InteractionLog は `botId` ごとに分離する。
自発話 planner と `memory-system` は互いの内部 repository に依存せず、会話履歴の参照や queue への投入は main 側の adapter が接続する。
