# 記憶・学習・proactive 会話機能の整理計画

## 目的

ローカルで 1 人のユーザーと長く関わり、人のように会話し、自分からも自然に話題を出す agent を作る。そのために、同じ会話から複数のシステムが独立してユーザー像を学習する状態を解消する。

多数の利用者へ提供するサービスではなく、所有者本人がローカルで運用することを前提とする。記憶には個人的な情報も保存でき、保存・修正・削除は所有者がローカルのデータと設定を直接管理する。

本計画では、既存 API・DB・ファイル形式との後方互換は維持しない。移行用の互換レイヤーや deprecated API は作らず、不要な package、型、フィールド、スコア、変換処理を削除する。

## 設計原則

- 永続会話履歴の正本はTurnRecord repository 1つだけにする。
- 1 つの事実や推定を複数のシステムで正本として保持しない。
- 各システムは 1 つの問いだけに答える。
- 保存データと一時的な判断結果を分ける。
- 数値スコアを増やさず、必要な分類と自然言語の根拠を使う。
- LLM に渡す会話形式と、学習時の意味分類を分ける。
- 取得元を差し替えるための境界は小さな interface とし、汎用 plugin framework は作らない。
- ユーザーの明示発言を最も強い根拠とするが、継続的な会話から得た自然言語の推定も利用できる。
- 人らしさは感情パラメーターの追加ではなく、会話の継続、話題の選択、相手への理解、自発性によって作る。
- proactive 機能の opt-in、説明 UI、通知管理、サービス運営者向けプライバシー機能は対象にしない。
- `no_response` は理由を特定できないため、興味の否定、再試行の要求、即時の追加発話のいずれにも直接変換しない。

## 目標アーキテクチャ

### Response agents (`ao` / `aka`)

起動時に `botId` を受け取る独立した response agent を複数起動する。現在の役割分担を維持する。

- `ao`: ユーザーとの通常会話を受け持つ基本人格
- `aka`: 技術・エンジニアリングに精通した専門人格

`ao` が必要に応じて `aka` へ依頼し、`aka` の回答をユーザーへつなぐ協力関係は実装済みの機能として維持する。これは未実装のmulti-agent frameworkではなく、bot間mentionとqueueを利用した現在の会話経路を指す。

責務:

- ユーザー入力への応答
- LangGraph checkpointerによるthread内の短期実行状態とrun再開
- 必要な記憶・知識・PolicyCard の取得
- queue から受け取った proactive 指示を、自然なユーザー向け発話へ変換
- 追加のユーザー入力が来た場合、古い応答を送らず最新文脈で応答し直す
- 直近履歴から未解決の質問、約束、現在話題を読み取り、必要に応じて会話を戻す

各response agentはユーザー像を独自に重複学習しない。LangGraph checkpoint、Episode、PolicyCardは`botId`で分離する。UserMemory、DailyEvent、knowledgeは1人のユーザーについてao/akaで共有する。暗黙の複製は行わない。

## 会話履歴の正本

永続会話履歴にはTurnRecord repositoryを使う。LangGraph checkpointerは各botの短期実行状態とagent run再開だけに使い、検索、Episode抽出、proactive反応判定の正本にしない。

現在memory-systemにあるTurnRecord repositoryを利用し、新しいconversation-history packageは作らない。main側がユーザーに見えるturnを1回だけ保存し、memory-systemとsimple-pomdp-systemは同じrepositoryを読み取り利用する。simple-pomdp-system独自のTurnRecordStore、file複製、ingest APIは削除する。

記憶のscopeを次に固定する。

| 情報 | scope |
|---|---|
| TurnRecord | botId + threadId |
| LangGraph checkpoint | botId + threadId |
| UserMemory / DailyEvent / knowledge | ao/aka共有 |
| Episode / PolicyCard | botId別 |
| TopicState / InteractionLog | botId別 |

### UserMemory

答える問い:

> 会話をまたいで、その人を理解するために再利用すべき情報は何か。

保存対象:

- 比較的安定した好み
- 明示的な制約や方針
- 継続中の作業上の前提
- 継続的な会話から得られた、その人についての有用な観察

保存しないもの:

- 日付付きの出来事
- agent が反応から推測した興味
- 応答戦略
- 会話ログ

初期段階では現在の note 方式を維持し、新しい汎用 UserFact モデルは導入しない。推定である場合は note の自然言語内でその旨と根拠を表現する。必要になるまで confidence、importance、strength などのスコアを追加しない。

UserMemory の境界は次のように固定する。

- 人柄、作業傾向、安定した好みの観察: UserMemory
- proactive 話題に対する興味の推定: simple-pomdp-system の TopicState
- 日付付きの行動: DailyEvent
- agent の応答方法: memory-system の PolicyCard

ユーザーが過去の情報を訂正した場合は、古い note を残したまま反対の note を追加しない。既存 note を検索して置換または削除する。訂正に必要なのは既存 note の識別と更新・削除操作だけとし、version、supersedes、履歴tableは追加しない。

### DailyEvent

答える問い:

> いつ、何が起きたか。

短い時系列記録として維持する。UserMemory や Episode と自動同期しない。日付検索が主目的であり、ユーザー嗜好の推定には直接使わない。

### memory-system

答える問い:

> 過去の会話経験から、同様の状況で main agent はどのように応答するとよいか。

これは通常のユーザー記憶ではなく、main agent の経験から作る procedural memory として差別化する。

維持する概念:

- TurnRecord: 根拠となる会話
- Episode: 状況、agent の行動、ユーザーの結果を表す経験
- PolicyCard: 類似状況で参照する応答方針

削除・縮小候補:

- ユーザー属性や興味を PolicyCard に保存する処理
- relationship 用 insight report
- relationship-system 専用 API と adapter
- 実運用で解決フローを持たない複雑な split candidate 管理
- 同じ判定を行う複数の merge/build usecase
- confidence や outcome を重複表現するフィールド

PolicyCard は最低限、次の意味だけを持つ。

```ts
type PolicyCard = {
  id: string;
  botId: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
  episodeIds: string[];
};
```

実装時には既存の `state/action/outcome` と比較し、情報量が増えない場合は rename だけに留めてもよい。新旧両方のフィールドは保持しない。

Episode 抽出と PolicyCard 更新は、ユーザーの明示的反応が存在する会話を優先する。agent 自身が生成した proactive 指示をユーザーの希望や行動の根拠として扱わない。

### simple-pomdp-system

答える問い:

> 今、どの方向の話題を、どのようにユーザーへ投げるか。

関心・通知・記憶全般を管理する package ではなく、proactive initiative に特化する。

維持する概念:

- `explore`: 広い領域または新しい表面的話題を試す
- `refine`: 反応のあった領域を細分化する
- `exploit`: 関心がありそうな方向で有用な情報を提供する
- InteractionLog: 何を試し、どのような反応があったか

planner が呼び出された場合は、必ず `explore / refine / exploit` のいずれかを選ぶ。話題の価値が低いことを理由に `do_nothing` を返さない。会話中は直前の会話へ関連する話題を優先し、関連候補がなければ未試行領域またはランダムな表面的話題から `explore` する。

「いつ planner を呼ぶか」は planner の選択肢とは分離する。scheduler、queue、会話イベントなど外側の起動条件が発話間隔を決める。これにより、`do_nothing` を残して発話頻度を間接制御する構造を避ける。

呼び出し契約を次の 2 種類に限定する。これは永続データ種別ではなく、planner 呼び出し時の一時的な入力である。

- conversation trigger: ユーザーへの通常応答を作る際に呼ぶ。選ばれた話題は同じ応答へ自然に含め、通常応答とは別の追加messageを送らない。
- scheduled trigger: 外側のschedulerが発話時刻と判定した場合に呼ぶ。選ばれた話題を 1 件の `agent_input` としてqueueへ送る。

通常会話の直接応答と自然な質問はresponse agentが担当し、すべての話題選択をsimple-pomdp-systemへ移さない。conversation triggerは、雑談でagent側の展開が期待される場合、直前話題が終わった場合、明示依頼への回答後に自然な関連話題を1つ加えられる場合だけ使う。短い確認、エラー、訂正、処理途中では使わない。scheduled triggerの間隔、時間帯、同時実行は外側で管理する。1回の起動からユーザーへ届くmessageは1件とする。

`UserBelief` は独立した包括的ユーザーモデルにしない。proactive 判断に必要な、話題への反応履歴を圧縮した状態だけを持つ。既存の count、interest、confidence が同じ判断を重複表現している場合は削減し、自然言語 summary と最小限の分類へ寄せる。

想定する最小形:

```ts
type TopicState = {
  topic: string;
  assessment: "unknown" | "avoid" | "possible" | "interested";
  evidence: string;
  lastTriedAt?: string;
};
```

`initiationTolerance`、initiation関連count、planner内部cooldown、`attemptCount`、`positiveCount`、`negativeCount`、5段階interest、3段階confidenceを削除する。発話時刻、間隔、pending上限、同時実行はschedulerとqueueが管理する。

## proactive 話題の入力源

simple-pomdp-system は記憶の正本を持たず、候補作成時に外部 source を読む。

汎用 plugin loader や動的 module discovery は作らず、次の小さな interface を定義する。

```ts
interface ProactiveContextSource {
  name: string;
  load(input: {
    botId: string;
    threadId: string;
    userId: string;
  }): Promise<string[]>;
}
```

service には `ProactiveContextSource[]` を constructor で渡す。各 source は読み取り専用とし、simple-pomdp-system から外部記憶を更新しない。

初期sourceは次の3つだけにする。

1. TurnRecordの直近会話
2. UserMemory
3. TopicState / InteractionLog

DailyEventは必要性が確認された後に追加する。オンライン情報は`exploit`選択後にknowledge-accessで調査する。PolicyCardは「どう応答するか」であり「何を話すか」ではないため、proactive話題sourceにはしない。

source ごとの重み、score、優先順位モデルは追加しない。取得した短い context と直近の InteractionLog を LLM に渡し、候補を 1 件選ばせる。

## proactive 内部指示と会話履歴

main agent が一般的な chat API を利用するため、proactive の内部指示を `role: user` として入力し、assistant 応答との 1 セットを保存する方式は維持できる。

ただし、LLM API 上の role と、学習上の発話主体を同一視しない。

追加する識別は TurnRecord 単位の 1 フィールドに限定する。

```ts
type TurnKind = "human" | "proactive" | "delegation";
```

- `human`: 実ユーザー入力とassistant応答
- `proactive`: 内部指示とagentからユーザーへの発話
- `delegation`: ao/aka間の依頼と回答

scheduled発話の`proactive` recordと、conversation triggerを統合した`human` recordの両方に既存の`sourceInteractionId`を引き継ぎ、対応するInteractionLogを追跡できるようにする。messageごとのorigin、visibility、causedByなどは追加しない。

学習規則:

- 内部指示の本文は再現性・監査のため保存する。
- proactive内部指示とdelegationをユーザーの好み、発言、行動として抽出しない。
- proactive発話後の実ユーザー入力だけを反応判定に使う。
- conversation triggerで統合した話題への反応もsourceInteractionIdで元のInteractionLogへ対応付ける。
- `no_response` は観測事実として InteractionLog に残せるが、topic の評価を変更しない。
- `no_response` を理由にすぐ追加で話しかけたり、同じ質問を再送したりしない。
- 明示的な肯定、否定、話題継続を主な evidence とする。

## relationship-system の廃止

`relationship-system` は main agent から完全に外す。

実施内容:

1. root `package.json` から依存を削除
2. `src/infrastructure/relationship` を削除
3. memory-system の relationship insight API を削除
4. relationship 専用の設定、script、環境変数を削除
5. `packages/relationship-system` を削除
6. relationship 関連テストと文書を削除または現行設計へ書き換え

機能を simple-pomdp-system へ移植しない。現在使われていない機能は削除し、必要性が実際に発生した場合だけ再設計する。

## system prompt と skills

### system prompt

system prompt は静的部分だけにする。

- identity と口調
- 会話上の基本方針
- tool 利用上の不変ルール
- memory の意味と禁止事項

日時、ユーザー記憶、PolicyCard、proactive の内部目的は request ごとの context として渡す。

`DeepAgentRuntime` の agent cache が動的 prompt を固定する問題を解消する。推奨方式は agent を bot ごとに 1 回作り、動的内容を invocation middleware/context/message で渡すこと。prompt文字列をcache keyへ含める方式はagentを増殖させるため採用しない。

削除する指示:

- 常に web 検索する指示
- 感情を過剰に表現する指示
- skills と system prompt の重複した tool 手順
- 存在しないagentや利用できない委譲経路だけを指す指示

`ao` と `aka` の協力者・委譲指示は削除しない。bot ID、mention先、役割分担は静的system promptに残し、実際のroutingと一致することをテストする。

### skills

skills はユーザー依頼に応じて読む作業手順に限定する。

- `knowledge-lookup`: 維持
- `web-ingest`: web取得の二重実行をなくして維持
- `user-memory`: 自動保存ルールを runtime 側へ移し、ユーザーが記憶を明示操作する skill または tool 説明へ縮小
- `daily-events`: 自動抽出を行う場合は background ingest 側へ移し、検索手順だけを skill に残す

UserMemory と DailyEvent の保存判断を両方 main agent の自由な tool call に委ねない。第一段階では明示的な保存依頼と訂正を処理する。第二段階で継続会話からの観察をbackground抽出するが、既存 note と意味が重なる場合は新規追加せず、維持・置換・削除のいずれかを選ぶ。

## 実装フェーズ

### Phase 0: 現状を固定する

- proactive ではない通常会話の統合テストを追加
- proactive 発話、次のユーザー反応、belief 更新までの統合テストを追加
- 処理中に追加のユーザー入力が到着するqueue競合テストを追加
- UserMemoryの訂正・削除・重複防止テストを追加
- conversation/scheduled triggerごとのproactive配信テストを追加
- 現在のDB table、file store、queue payload、TurnRecord複製経路を列挙
- relationship-system が実行経路にないことを確認

完了条件:

- 削除前後で比較すべき最小シナリオがテストとして存在する
- 使用中・未使用の永続データが明確になっている

### Phase 1: relationship-system を削除する

- 前述の package、client、API、設定、テストを削除
- root build と主要テストを通す

完了条件:

- `rg relationship` で歴史文書以外の実装参照がない
- main agent、memory-system、simple-pomdp-system が単独でbuildできる

### Phase 2: TurnRecord の意味を修正する

- `TurnKind` にhuman/proactive/delegationを追加
- main側からユーザー可視turnをTurnRecord repositoryへ1回だけ保存
- simple-pomdp-system独自のTurnRecordStore、file複製、ingest APIを削除
- memory-systemとproactive sourceを同じTurnRecord repositoryへ接続
- proactive/conversation recordにInteractionLog IDを保持
- memory-system の Episode 抽出から proactive 内部指示をユーザー evidence として除外
- simple-pomdp-system の反応観測で human record のみを評価

完了条件:

- 内部指示は履歴に残る
- proactive内部指示とdelegationからユーザー嗜好が生成されない
- ユーザー可視turnがTurnRecord repositoryへ1回だけ保存される
- memory-systemとsimple-pomdp-systemが同じTurnRecordを読む
- proactive 発話後のユーザー反応を元のInteractionLogへ関連付けられる

### Phase 3: simple-pomdp-system を initiative 専用に縮小する

- `DialogueDecisionKind`から`do_nothing`を削除し、関連branch・log・testを削除
- initiationTolerance、initiation関連count、planner内部cooldown、重複scoreを削除
- `ProactiveContextSource` を導入
- recent turns と UserMemory adapter を実装
- UserBelief の重複フィールドを削減
- context取得、判断、research、dispatch、observation を別工程として整理
- package 名を実態に合わせて変更するか判断する

名称変更を行う場合は `proactive-dialogue` または `initiative-planner` とし、旧package aliasは残さない。

完了条件:

- source を差し替えても planner 本体を変更しない
- planner が外部記憶へ書き込まない
- explore/refine/exploit の判断と反応更新だけを担当する
- ランダム探索は未試行領域の候補提示として実現し、細かな乱数scoreを永続化しない
- 呼び出された場合は必ず 1 件の話題を返し、conversation triggerでは通常応答へ統合し、scheduled triggerではqueueへ送る

### Phase 4: memory-system を procedural memory に限定する

- relationship insight を削除
- Episode抽出対象をhuman interaction中心にし、proactive内部指示とdelegationをユーザー結果から除外する
- PolicyCard schema と更新フローを縮小
- merge/split/build usecase の重複を統合
- 実際に参照されない report、candidate、field、table を削除

完了条件:

- PolicyCard がユーザーprofileではなく応答方針だけを表す
- PolicyCardから根拠Episodeへ追跡できる
- 同じ情報を表す複数フィールドがない
- main agentへの注入文が短く、適用条件と行動が判別できる

### Phase 5: UserMemory の保存・訂正を一本化する

- 既存 note の検索、置換、削除を repository と tool に追加
- ユーザーの明示的訂正では対象 note を置換し、矛盾noteを併存させない
- background観察は既存 note と照合し、同義なら追加しない
- 推定内容を保存する場合は、自然言語内に推定であることと根拠を残す
- UserMemory、TopicState、DailyEvent、PolicyCard の境界に従って保存先を1つだけ選ぶ

完了条件:

- 「以前の情報は違う」という訂正後に古いnoteが検索結果へ出ない
- 同じ意味のnoteが会話ごとに増殖しない
- proactive話題への興味がUserMemoryへ複製されない
- UserMemoryとDailyEventがao/aka間で共有され、bot別に複製されない
- 追加する永続フィールドや履歴tableがない

### Phase 6: response agent の context 構築を一本化する

同じcontext builderを `ao` と `aka` で利用し、`botId` に応じて人格、専門性、PolicyCard、checkpoint namespaceを切り替える。agent cacheと会話履歴をbot間で共有しない。

request ごとに、次を 1 か所で組み立てる。

1. 静的system prompt
2. 現在日時
3. 必要なUserMemory
4. 必要なDailyEvent
5. 適用可能なPolicyCard
6. proactiveの場合のみ内部目的と取得済み根拠

- system prompt cache問題を修正
- 実userIdを全tool、memory、threadへ渡す
- `defaultUserId: "discord-user"` を削除
- LLMに任意userIdを指定させない

完了条件:

- 2回目以降の応答でも最新contextが反映される
- `ao`と`aka`のcheckpoint、Episode、PolicyCardが混線しない
- 共有UserMemory、DailyEvent、knowledgeを両botが同じ正本から読む
- `ao` から `aka` への委譲が実際のmention/routingで成立する
- 同一ユーザーの情報が複数namespaceへ分裂しない
- proactive内部目的が通常のユーザー発言として学習されない

### Phase 7: queue と自然な会話の協調を追加する

- threadごとに単調増加する `conversationVersion` をqueue taskへ持たせる
- ユーザー入力をenqueueするたびにversionを進める
- 応答送信前に最新versionを確認し、古いtaskの結果は送信しない
- 古いtaskの処理中に入力が増えた場合は、最新入力と直近履歴から1回だけ再計画する
- 未処理の連続入力は、意味を失わない範囲で同じ応答単位へまとめる
- 未解決の質問、agentの約束、現在話題、復帰可能な直前話題をTurnRecordからrequestごとに短く導出する
- この会話focusは永続モデルや新tableにせず、context builderの一時出力とする
- 長時間のtool処理ではtypingを維持し、利用中のtransportで安全に可能な場合だけ短い途中経過を送る。streaming専用の共通frameworkは作らない

完了条件:

- 追加発言後に古い文脈だけを前提とした応答が送信されない
- 再計画が無限enqueueや重複送信を起こさない
- 同じユーザー入力に通常応答とconversation-trigger発話を別々に送らない
- agentが未回答の質問や自分の約束を忘れず、話題転換後に自然に復帰できる
- 短い通常会話に不要な途中経過messageを追加しない

### Phase 8: skills と重複toolを整理する

- skillsとsystem promptの重複を削除
- `web_page` と `save_web_knowledge` の二重fetchを解消
- memory保存・検索toolの責務と命名を揃える
- 使用されていない filesystem memory 経路を削除

完了条件:

- 1つの操作につき主要toolが1つ
- skill本文は短く、tool descriptionの単なる反復になっていない
- 常時必要な規則がskillに隠れていない

## 検証シナリオ

### 通常会話

- 複数turnで文脈が継続する
- 応答生成中の追加発言を反映し、古い応答を破棄または再計画する
- 未解決の質問とagentの約束を追跡し、話題転換後に必要なら復帰する
- 同じ質問や同じ話題展開を不自然に繰り返さない
- ユーザーの訂正後は古い内容を使わず、矛盾noteを併存させない
- 記憶がない場合は推測で埋めず、覚えていないと判断する
- 1つの継続チャット内で、出来事の前後関係と日時を正しく扱う
- 日付付き出来事と安定した好みが混ざらない
- 2回目以降も現在日時と最新PolicyCardが反映される

### procedural memory

- 類似状況で適切なPolicyCardだけが取得される
- proactive内部指示だけからPolicyCardが作られない
- 異なる推奨行動を持つEpisodeが誤ってmergeされない
- 根拠のない場合はPolicyCardを適用しない

### proactive 会話

- 初期状態では複数の広い領域を順にexploreする
- 会話中は、直前の会話と自然につながる話題を優先する
- 関連話題がなければ未試行領域またはランダムな表面的話題をexploreする
- 明示的に反応した領域をrefineする
- 十分な反応がある領域では外部情報を調査してexploitする
- 否定された領域を繰り返さない
- 無反応だけでtopicの評価を変更しない
- 無反応を理由に即座の再発話を行わない
- plannerを起動した場合は必ずexplore/refine/exploitのいずれかを返す
- 発話間隔はplannerの選択肢ではなく外側の起動条件で制御する
- conversation triggerでは通常応答に話題を統合し、messageを二重送信しない
- scheduled triggerでは1件だけqueueへ送り、同時起動しても重複送信しない
- 内部指示、agent発話、後続のhuman反応を同じInteractionLogへ追跡できる

### 人らしい会話の定性fixture

固定した長い会話fixtureで、次をassertする。自動scoreは追加しない。

- 相槌や短い確認ごとに新しい話題を追加しない
- 会話途中で無関係なランダム話題へ飛ばない
- 話題変更に自然な接続がある
- proactive発話が質問だけでなく情報提供、感想、共有を含む
- 過去の出来事を適切な文脈で思い出す
- agent自身の発言や約束と矛盾しない
- ao/akaの口調と専門性が混ざらない
- aoからakaへの委譲が機械的な転送に見えない
- 否定された話題を言い換えて再提示しない

### 削除確認

- relationship-systemへのruntime参照がない
- simple-pomdp-system独自のTurnRecord保存がない
- initiationTolerance、do_nothing、重複countがない
- 廃止したtable、interface、adapterのimportがない
- 互換目的だけのwrapper、alias、変換処理が残っていない

## 評価範囲

会話は 1 人のユーザーとの 1 つの継続チャットとして扱う。別session間の記憶統合やsession境界をまたぐ推論は評価対象にしない。一方、同じ継続チャット内での長期的な訂正、時間関係、話題復帰、反復防止は評価する。

## 非目標

- 厳密な確率分布、報酬関数、belief transitionを持つ数理POMDP
- 数値scoreの細分化
- 汎用plugin marketplaceや動的plugin loader
- 新しいconversation-history package
- 複数ユーザー・複数tenant向けの一般化（複数botの `ao` / `aka` 構成は対象に含む）
- proactive表示UI、通知設定画面、opt-in画面
- 外部サービス提供を前提としたtenant分離、管理者向け監査、包括的なprivacy console
- 人格らしさを定量化する新しい感情モデル

ただし、将来UIを追加できるように、InteractionLogとqueue taskのID追跡は維持する。

## 最終的に残る依存方向

```text
Response agents (ao / aka)
  -> bot-specific prompt / LangGraph checkpoint / PolicyCard
  -> queue
  -> TurnRecord repository (persistent conversation)
  -> shared knowledge-access / UserMemory / DailyEvent
  -> proactive planner

Proactive planner
  -> TurnRecord repository (read adapter)
  -> UserMemory (read adapter)
  -> TopicState / InteractionLog
  -> knowledge-access (exploit research)
  -> queue (scheduled dispatch)

memory-system
  -> TurnRecord repository (read)
  -> Episode
  -> PolicyCard
```

`memory-system` と proactive planner は互いの内部repositoryへ直接依存しない。連携が必要な場合も、main agent側で読み取りadapterを組み立てる。

## 実装開始時の判断基準

各型・フィールド・classを追加する前に、次のすべてへ回答する。

1. どの具体的な判断または検索に必要か。
2. 既存情報から導出できないか。
3. 永続化する必要があるか。
4. 既存フィールドを置き換えて削除できるか。
5. この情報がない場合に失敗するテストは何か。

明確な回答とテストがなければ追加しない。
