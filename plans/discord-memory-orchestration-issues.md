# Discord memory orchestration: GitHub Issue drafts

元計画: [Discord response agent・記憶検索・proactive入力統合計画](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md)

この文書はIssue本文案だけを定義する。Issue作成と実装は行わない。

## 推奨実行順と依存関係

```text
#1 現状固定
 ├─ #2 MemoryService契約
 │   ├─ #3 UserMemory移管
 │   │   └─ #4 UserMemory意味検索
 │   ├─ #5 DailyEvent移管・検索
 │   ├─ #6 TurnRecord補助検索
 │   └─ #7 PolicyCard検索境界
 │       └─ #8 Memory/Knowledge Catalog
 │           ├─ #9 DeepAgent memory tools
 │           └─ #12 simple-pomdp memory adapter
 ├─ #10 checkpoint圧縮
 └─ #11 ResponseInputEnvelope

#9 + #10 + #11 + #12
 └─ #13 conversation analysis廃止・Discord統合

#4 + #5 + #6
 └─ #14 記憶候補分類・更新判断
      └─ #15 background worker・起動接続

#13 + #15
 └─ #16 Discord E2E・不要経路削除
```

`#3`、`#5`、`#6`、`#7`は`#2`完了後に並行実装できる。`#10`と`#11`はmemory検索実装から独立して進められる。

---

## Issue 1: Discord会話・記憶経路のcharacterization testを追加する

### Background

記憶取得とconversation triggerの構造を変更する前に、現在維持すべきDiscordの挙動をテストで固定する必要がある。特にcheckpointによる短期会話、TurnRecordの1回保存、stale response破棄、human/proactiveの識別が回帰しない状態を作る。

元計画: [Phase 0](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#phase-0-discordの現状を固定する)

### Scope

- Discordの同一bot/threadで2回目の応答が直前の会話stateを参照するテストを追加する。
- mention、conversation trigger、scheduled proactiveのTurnRecord保存内容を固定する。
- stale responseが送信・保存されないことを固定する。
- 現行UserMemoryの言い換え検索が一致しないケースをrepository testで再現する。
- 12件より古いTurnRecordがConversation Focusに含まれないケースを固定する。

### Out of scope

- 記憶検索方式の変更。
- checkpoint summarization設定の変更。
- `createConversationAnalysisService`の削除。
- Terminal版の変更。

### Implementation notes

- 本Issueでは失敗を表すcharacterization testを無理にgreenにせず、未実装要件は`todo`または明示的な現状期待として記録する。
- 外部Ollama/Postgresが不要なfixtureを優先し、DB固有動作だけintegration testへ置く。
- ユーザー可視turnの保存回数を明示的にassertする。

### Acceptance criteria

- 現在維持すべきDiscord挙動が自動テストで説明されている。
- 既知の長期記憶検索不足が再現可能になっている。
- production codeの挙動を変更していない。

### Tests

- `src/ui/discord/discordBotApp.test.ts`
- `src/e2e/finalArchitecture.e2e.test.ts`
- UserMemory/Postgres integration test
- Node 23以上で対象testと`build:all`

---

## Issue 2: memory-systemの公開契約とclientを定義する

### Background

UserMemory、DailyEvent、TurnRecord、PolicyCardの取得がmain側のrepositoryや個別clientへ分散している。保存・検索方法をmemory-system内へ隠蔽する前に、小さく安定した公開契約を定義する。

元計画: [memory-system公開境界](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#memory-system公開境界)

### Scope

- `MemoryScope`、`MemorySearchRequest`、scope別result型をmemory-systemの公開APIへ追加する。
- `found / not_found / unavailable`を表現する共通result型を追加する。
- `MemoryCatalog`と`inspectCatalog`の公開型を追加する。
- `recordTurn`と既存PolicyCard取得を後続移行できるclient facadeを定義する。
- bot/thread/user scopeの契約を型とテストで固定する。

### Out of scope

- 各scopeの意味検索実装。
- main側repositoryの削除。
- DeepAgent toolの追加。
- DB migration。

### Implementation notes

- `botId / threadId / userId`はcallerが渡すservice境界には含めるが、LLM向けtool引数には公開しない。
- TurnRecordは現状`userId`を持たないため、単一ユーザー前提のまま`botId + threadId`で扱う。
- 内部embedding scoreやraw JSONを公開型へ追加しない。
- 空配列とbackend障害を区別できる契約にする。

### Acceptance criteria

- mainとsimple-pomdpが依存できるmemory-system公開型が存在する。
- 公開型だけではDB実装やembedding providerへ依存しない。
- 既存利用箇所は破壊せず、段階移行可能である。

### Tests

- memory-systemの型・service contract unit test
- `found / not_found / unavailable`のserialization test
- scope validation test
- memory-system buildとroot `build:all`

### Dependencies

- #1

---

## Issue 3: UserMemoryのrepositoryと書き込みAPIをmemory-systemへ移管する

### Background

UserMemoryのPostgres repositoryとwrite plannerがmain側にあり、memory-systemが唯一の記憶境界になっていない。意味検索を追加する前に、既存の保存・検索・置換・削除と重複防止をmemory-systemへ移す。

元計画: [UserMemory](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#usermemory)

### Scope

- UserMemoryのdomain型、repository、service APIをmemory-systemへ移す。
- remember/search/replace/deleteと既存write plannerの振る舞いを維持する。
- userId共有scopeを維持し、botId namespaceを追加しない。
- main側はmemory-system client経由で明示的な保存・訂正・削除を行う。
- 移管後に不要となるmain側の重複型・wrapperを削除する。

### Out of scope

- embedding検索。
- background自動抽出。
- DailyEventの移管。
- memory toolのprompt設計。

### Implementation notes

- 後方互換wrapperは残さず、同一変更内で参照を置換する。
- 既存noteとのcreate/keep/replace/delete判断を保持する。
- DB tableの不要な変更は行わない。

### Acceptance criteria

- UserMemoryの読み書きがmemory-system client経由に一本化される。
- ao/akaが同じuserIdのnoteを共有する。
- 訂正後に古いnoteが検索結果へ残らない。
- 同一noteが重複保存されない。

### Tests

- memory-system UserMemory service unit test
- Postgres repository integration test
- ao/aka共有scope test
- mainのcustom tool test
- memory-system、root build/test

### Dependencies

- #2

---

## Issue 4: UserMemoryへ意味検索とhybrid rankingを追加する

### Background

現在の入力全文`ILIKE`では「ジャズが好き」を「どんな音楽が好み？」から取得できない。UserMemoryを主要なsemantic memoryとして使うため、言い換えに対応した検索が必要である。

元計画: [UserMemory関連記憶検索](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#usermemory)

### Scope

- UserMemory noteのembedding生成・保存・再生成経路を追加する。
- semantic searchを主、短い全文検索を補助とするhybrid rankingを実装する。
- 書き込み・置換時にembeddingを更新する。
- 既存noteのbackfill手段を追加する。
- 内部scoreを公開resultから除外する。

### Out of scope

- TurnRecordとDailyEventのembedding。
- Memory Catalog。
- 自動UserMemory抽出。
- importance/confidenceフィールドの追加。

### Implementation notes

- embedding providerは注入可能にし、testではdeterministic fakeを使う。
- embedding生成失敗で正本noteを失わない。
- 未index noteを再処理できる状態を残す。
- userId以外のscopeで絞り込まない。

### Acceptance criteria

- 言い換えqueryから関連UserMemoryを取得できる。
- 無関係なnoteが上位結果へ常態的に混入しない。
- replace後は新しい内容が検索され、古い内容が検索されない。
- embedding障害は`unavailable`として識別できる。

### Tests

- semantic/hybrid ranking unit test
- create/replace/delete時のindex更新test
- backfill idempotency test
- Postgres integration test
- memory-system build/test

### Dependencies

- #3

---

## Issue 5: DailyEventをmemory-systemへ移管し日時・内容検索を実装する

### Background

DailyEventは主要なepisodic memoryだが、repositoryがmain側にあり、内容検索は入力全文の部分一致に依存している。memory-systemへ移し、構造化した日付条件と内容検索を組み合わせる。

元計画: [DailyEvent](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#dailyevent)

### Scope

- DailyEventのdomain型、repository、service APIをmemory-systemへ移す。
- 公開型・DBから不要な`botId`を削除し、userId共有scopeへ固定する。
- `from / to`の日付filterを追加する。
- 内容の意味検索または全文検索を追加する。
- 明示的な保存・検索toolをmemory-system clientへ接続する。

### Out of scope

- 自然会話からのDailyEvent自動抽出。
- UserMemoryやTurnRecord検索。
- calendar連携。
- Terminal版。

### Implementation notes

- 日付filterはembedding後の後処理ではなくDB query条件へ含める。
- eventDateとcreatedAtを混同しない。
- ao/akaで同じeventを検索可能にする。
- embeddingを使う場合も生成失敗で正本eventを失わない。

### Acceptance criteria

- 日付範囲と内容の両方でDailyEventを検索できる。
- 言い換えられた出来事を取得できる。
- botIdに関係なくao/akaが同じeventを参照できる。
- main側に重複repositoryが残らない。

### Tests

- date range境界test
- semantic/text search test
- ao/aka共有scope test
- DB migration/integration test
- memory-system、root build/test

### Dependencies

- #2

---

## Issue 6: TurnRecordの補助的な関連会話検索を追加する

### Background

UserMemory、PolicyCard、DailyEventに残すべきでない具体的な過去会話を思い出す手段がない。TurnRecordを正本のまま維持し、再生成可能な派生indexから関連会話を検索できるようにする。

元計画: [TurnRecord関連記憶検索](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#turnrecord)

### Scope

- TurnRecord IDに関連付けた検索用embedding indexを追加する。
- embedding textへ`kind`とmessage `role`を含める。
- query、`from / to`、`roles`、`kinds`、limitによる検索を実装する。
- botId/threadIdをruntime由来の検索scopeとして固定する。
- 日時、短いexcerpt、TurnRecord IDを返す。
- 既存TurnRecordのbackfillを追加する。

### Out of scope

- TurnRecordへの明示的なuserId追加。
- UserMemoryの代替としてのprofile生成。
- raw会話全文のLLM注入。
- bot/thread横断検索。

### Implementation notes

- 正本の`messagesJson`は変更しない。
- proactive/delegationを実ユーザー発言としてrankingしない。
- role filter指定時もinteractionの意味が分かる最小限の文脈をexcerptへ残す。
- checkpoint直近範囲と重複する結果をcallerが除外できるようTurnRecord IDを返す。

### Acceptance criteria

- 12件より古い音楽会話を意味検索で取得できる。
- user発言とassistant発言をfilterで区別できる。
- human/proactive/delegationをfilterで区別できる。
- 日付範囲外のturnを返さない。
- 検索indexを正本TurnRecordから再生成できる。

### Tests

- role/kind/date filter unit test
- semantic ranking test
- backfill idempotency test
- Postgres integration test
- memory-system build/test

### Dependencies

- #2

---

## Issue 7: PolicyCard検索を統一MemoryService境界へ移す

### Background

PolicyCardはprocedural memoryだが、現在は専用client呼び出しとRequest Contextへの先行注入に依存している。DeepAgentが必要時に取得できるよう、他の記憶と同じ検索契約へ統合する。

元計画: [PolicyCard](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#policycard)

### Scope

- `policy_cards` scopeを`MemoryService.search`へ実装する。
- botId別scopeを維持する。
- queryに適用可能なPolicyCardを最大3件返す。
- 公開resultをappliesWhen、recommendedBehavior、avoidBehavior、IDに限定する。
- 現行`queryApplicablePolicyCards`のcallerを段階移行する。

### Out of scope

- Episode/PolicyCard生成ロジックの再設計。
- UserMemoryやDailyEvent検索。
- DeepAgent tool追加。
- PolicyCardの常時注入。

### Implementation notes

- Episode本文や根拠会話全文を返さない。
- 内部類似度scoreを公開しない。
- ao/akaのbot scope混線をcontract testで防ぐ。

### Acceptance criteria

- 統一MemoryServiceから適用可能なPolicyCardを取得できる。
- 異なるbotIdのPolicyCardが返らない。
- 返却payloadが計画上の最小フィールドに収まる。

### Tests

- policy scope service test
- bot分離test
- 最大3件・payload formatter test
- memory-system build/test

### Dependencies

- #2

---

## Issue 8: Memory CatalogとKnowledge Catalogを実装する

### Background

Agentは保存内容の存在を知らないと詳細検索を選べない。一方、記憶本文を毎requestへ注入すると過剰になる。保存領域と代表topicだけを返す軽量Catalogを用意する。

元計画: [DeepAgentへ提供するmemory tools](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#deepagentへ提供するmemory-tools)

### Scope

- memory-systemへUserMemory、DailyEvent、PolicyCard、過去会話のCatalog生成を追加する。
- knowledge-accessへ保存記事のKnowledge Catalogを追加する。
- available、代表topic、updatedAt、DailyEventのdateRangeを返す。
- Catalogを再生成可能な派生indexまたは集約queryとして実装する。
- service単位の失敗を`unavailable`として返す。

### Out of scope

- DeepAgent toolへの集約。
- 記憶本文、件数一覧、内部scoreの返却。
- Catalogを新しい正本として扱うこと。
- topic importance/confidenceの永続化。

### Implementation notes

- 件数だけでなく検索判断に使える短いtopic hintを返す。
- topic数と文字数に厳しい上限を置く。
- knowledgeをmemory-systemへ複製しない。
- 空とbackend障害を区別する。

### Acceptance criteria

- 各記憶領域と保存記事の利用可否・代表topicを軽量に取得できる。
- Catalogから記憶本文や内部scoreが漏れない。
- 元データから再生成できる。
- 一領域の失敗で他領域のCatalogを失わない。

### Tests

- Catalog formatter/limit test
- 空、available、unavailable test
- 再生成idempotency test
- memory-systemとknowledge-accessのbuild/test

### Dependencies

- #3、#5、#6、#7

---

## Issue 9: DeepAgentへ二段階memory tool探索を追加する

### Background

現在はRequestContextBuilderが記憶を先行検索しており、response agentが必要な記憶を判断していない。Catalogで利用可能な領域を確認し、必要な詳細toolだけ呼ぶ構成へ移す。

元計画: [DeepAgentへ提供するmemory tools](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#deepagentへ提供するmemory-tools)

### Scope

- memory-systemとknowledge-accessのCatalogを集約する`inspect_context_catalog` toolを追加する。
- `search_conversation_memory`、`search_user_memory`、`search_daily_events`、`search_response_policies`を追加する。
- runtime contextからbotId/threadId/userIdを注入する。
- system promptへ記憶種別と二段階探索の大まかな行動方針を追加する。
- RequestContextBuilderのUserMemory、DailyEvent、PolicyCard、記事の先行検索を削除する。
- Request Contextを日時・origin・proactive metadata中心へ縮小する。

### Out of scope

- checkpoint圧縮。
- conversation trigger判定。
- background記憶抽出。
- Terminal版tool統合。

### Implementation notes

- Catalogは毎request必須にしない。
- 過去、ユーザー自身、好み、予定、保存情報が関係し得る場合にCatalogを使うよう説明する。
- `unavailable`を記憶なしと解釈させない。
- `not_found`時のquery変更は最大1回にする。
- tool resultとloop回数へ上限を設定する。

### Acceptance criteria

- 記憶が関係する入力ではCatalogから詳細検索へ進める。
- 挨拶や短期会話だけで答えられる入力ではmemory toolを呼ばない。
- LLMがbotId/threadId/userIdを指定できない。
- 記憶本文を毎requestへ先行注入しない。
- 同じ記憶が複数sectionへ重複しない。

### Tests

- tool schema/runtime scope test
- Catalogからscope別検索へ進むAgent fixture test
- no-tool path test
- unavailable/not_found retry test
- Request Context formatter test
- root build/test

### Dependencies

- #4、#5、#6、#7、#8

---

## Issue 10: DeepAgent checkpointの要約閾値と直近interaction保持を管理する

### Background

DeepAgent 1.7.0の既定値は約170,000 tokenで要約し直近6 messagesを残す。使用Ollama modelのcontext上限と一致する保証がなく、message数ではhuman/proactive interactionのまとまりも保てない。

元計画: [checkpoint短期履歴の管理](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#checkpoint短期履歴の管理)

### Scope

- 使用modelのcontext上限を設定または起動時設定として扱う。
- context上限より十分手前でsummarizationを開始する。
- 要約後に直近N interactionsと進行中tool stateを保持する。
- 大きなtool resultを次turn用に短縮する。
- DeepAgent既定summarizationとの二重適用を防ぐ。

### Out of scope

- 長期TurnRecord検索。
- proactive origin metadataのdomain設計。
- Terminal版MemorySaver。
- TurnRecord正本の要約置換。

### Implementation notes

- まずDeepAgent公開APIで設定可能か確認する。
- 設定不能ならagent生成層の局所的な置換またはupstream対応を選ぶ。
- Nはmessage数ではなく入力とAgent応答のinteraction単位として扱う。
- 会話要約はcheckpoint内の再生成可能な短期状態に限定する。

### Acceptance criteria

- model context上限より前に要約が開始される。
- 要約後も設定した直近N interactionsが残る。
- tool call途中のstateが破損しない。
- summarization middlewareが二重実行されない。

### Tests

- token threshold test
- interaction保持test
- tool message圧縮test
- checkpoint resume test
- Discord runtime build/test

### Dependencies

- #1

---

## Issue 11: ResponseInputEnvelopeとproactive origin metadataを導入する

### Background

human、scheduled proactive、delegationは同じresponse agentを使うべきだが、入力由来を失うとproactive疑似Humanを実ユーザー発言として学習する。入力と履歴へ明示的なoriginを持たせる。

元計画: [入力envelope](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#入力envelope)

### Scope

- `ResponseInputEnvelope`と`ResponseInputOrigin`を追加する。
- Discord mentionとagent_inputからenvelopeを生成する。
- checkpoint message metadataへhuman/proactive/delegation originを保持する。
- proactive疑似Human本文を空にせず保持する。
- TurnRecordのkind/sourceInteractionIdとのmappingを一箇所へ集約する。
- human/proactiveを共通response実行関数へ寄せる。

### Out of scope

- simple-pomdpのconversation opportunity変更。
- checkpoint要約アルゴリズム。
- background抽出。
- Terminal版。

### Implementation notes

- API上user role相当で渡す既存方式は維持する。
- originはLLMが入力する値ではなくqueue/runtimeが決める。
- 通常会話表示ではproactiveを`Assistant initiated`として整形できるmetadataを残す。
- 監査用raw instructionはTurnRecordへ維持する。

### Acceptance criteria

- human/proactive/delegationが同じDeepAgent runtimeを利用する。
- proactive疑似Human内容が失われない。
- proactive/delegationを実ユーザー事実として識別しない。
- TurnRecordのkindとcheckpoint originが一致する。

### Tests

- envelope mapping unit test
- checkpoint metadata persistence test
- human/proactive共通runner test
- TurnRecord kind/sourceInteractionId test
- Discord build/test

### Dependencies

- #1

---

## Issue 12: simple-pomdpをMemoryServiceへ接続しconversation opportunity APIを追加する

### Background

simple-pomdpはTurnRecordReaderやUserMemory adapterを直接知り、main側のConversation Analysisが呼び出し可否を先に判断している。記憶取得をMemoryServiceへ寄せ、initiative判断をsimple-pomdp自身へ移す。

元計画: [simple-pomdp-system](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#simple-pomdp-system)

### Scope

- simple-pomdpのTurnRecord/UserMemory context sourceをMemoryService adapterへ置換する。
- `assessConversationOpportunity`を追加する。
- active conversation、確認、訂正、処理途中、error時を不実行として判定する。
- opportunityがある場合だけ`planInteraction`で`explore/refine/exploit`を選ぶ。
- 不実行理由と話題選択resultを別型にする。
- scheduled triggerの既存挙動を維持する。

### Out of scope

- Discord側`createConversationAnalysisService`削除。
- response agentが候補を採用する最終判断。
- TopicState/InteractionLog schemaの全面変更。
- `do_nothing`の復活。

### Implementation notes

- opportunity不実行をTopicStateへ話題評価として保存しない。
- plannerが呼ばれた場合は必ず`explore/refine/exploit`を返す。
- recent turnsをMemoryServiceと別sourceから二重取得しない。
- 保存記事はknowledge-accessから読み、memory-systemへ複製しない。

### Acceptance criteria

- conversation trigger可否をsimple-pomdp単体で判断できる。
- 不実行時にplannerを呼ばない。
- 実行時に`explore/refine/exploit`のいずれかを返す。
- scheduled triggerの配信契約が維持される。
- 外部記憶へ書き込まない。

### Tests

- opportunity判定table test
- planner invocation count test
- `do_nothing`不在test
- MemoryService adapter test
- conversation/scheduled trigger regression test
- simple-pomdp build/test

### Dependencies

- #2、#6、#8

---

## Issue 13: createConversationAnalysisServiceを廃止してDiscordへ新フローを統合する

### Background

Conversation Analysisは現在話題、未解決質問、約束、trigger可否を通常回答前の別LLM callで判定し、DeepAgentとsimple-pomdpの責務に重複している。新しいmemory tools、input envelope、opportunity APIへ置換する。

元計画: [`createConversationAnalysisService`の廃止](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#createconversationanalysisserviceの廃止)

### Scope

- `conversationFocus.ts`とConversation Analysis型を削除する。
- Request ContextのConversation Focus sectionを削除する。
- DiscordBotAppの`analyzeConversation`とanalysis依存を削除する。
- `runDiscord.ts`のanalysis model生成・DIを削除する。
- simple-pomdpのopportunity/candidateをhuman response runへ渡す。
- candidateを最終回答へ採用するかDeepAgentが判断できるようにする。
- scheduled proactiveを同じresponse runtimeで維持する。

### Out of scope

- Terminal版からのConversation Analysis削除。
- 新しい永続ConversationFocus model。
- memory検索実装の変更。
- background記憶抽出。

### Implementation notes

- 未解決質問と約束はまずcheckpoint短期messagesからDeepAgentが扱う。
- 古い具体的話題はTurnRecord補助検索を利用する。
- conversation candidateを別messageとして送らない。
- candidate不採用はplannerの`do_nothing`とは区別する。

### Acceptance criteria

- Discord通常応答前のConversation Analysis LLM callがなくなる。
- simple-pomdpだけがconversation opportunityと話題候補を判断する。
- DeepAgentが確認・訂正・tool失敗時に候補を無理に追加しない。
- human応答とconversation candidateが最大1 messageになる。
- stale response保護とTurnRecord 1回保存が維持される。

### Tests

- Conversation Analysis非呼び出しtest
- opportunity/candidate統合test
- candidate採用・不採用test
- stale response regression test
- Discord E2Eとroot build/test

### Dependencies

- #9、#10、#11、#12

---

## Issue 14: human TurnRecordからUserMemory・DailyEvent候補を分類する

### Background

明示的な保存依頼だけでは、継続会話から得た安定した好みや出来事が主要記憶へ反映されない。workerへ接続する前に、human TurnRecordから適切な記憶候補と更新操作を決める副作用の小さいapplication serviceを実装する。

元計画: [background記憶抽出](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#background記憶抽出)

### Scope

- human TurnRecordから記憶候補を抽出するserviceを追加する。
- UserMemory、DailyEvent、保存しない、へ分類する。
- UserMemory候補を意味検索し、create/keep/replace/deleteを選ぶ。
- DailyEvent候補からeventDateとsummaryを構造化する。
- 分類・更新判断を実行する単一TurnRecord用use caseを追加する。

### Out of scope

- proactive/delegationからのユーザー記憶抽出。
- TopicStateとPolicyCard生成の再設計。
- 一時的な話題や弱い興味推定の保存。
- 保存記事の生成。
- background polling、processed管理、起動scriptへの接続。

### Implementation notes

- proactive/delegationの内部指示をユーザーの事実として扱わない。
- 安定した好み・制約・継続作業前提だけをUserMemoryへ保存する。
- 日付付き行動はDailyEventだけへ保存し、UserMemoryへ複製しない。
- 明示的な保存・訂正は引き続きhot pathで即時反映する。

### Acceptance criteria

- human会話から適切なUserMemoryまたはDailyEventが生成される。
- 同義UserMemoryが会話ごとに増殖しない。
- 訂正時に反対のnoteを併存させない。
- proactive/delegationからUserMemoryやDailyEventを生成しない。
- 同じTurnRecordを再評価しても同じ分類・更新判断になる。

### Tests

- classification fixture test
- create/keep/replace/delete test
- proactive/delegation除外test
- deterministic classification test
- memory-system、root build/test

### Dependencies

- #4、#5、#6

---

## Issue 15: background記憶抽出workerを冪等化してDiscord運用へ接続する

### Background

#14で実装した分類・更新use caseを、未処理TurnRecordへ継続適用し、失敗や再起動後も重複保存せず回収できる実行基盤が必要である。

元計画: [background記憶抽出](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#background記憶抽出)

### Scope

- 未処理human TurnRecordを列挙するbackground runnerを追加する。
- processed TurnRecord IDまたは同等のcheckpointで冪等化する。
- 成功時だけprocessed状態を更新する。
- 失敗したTurnRecordを次回起動で再処理する。
- batch件数、poll間隔、同時実行数へ上限を設ける。
- Discord運用の起動構成へworkerを追加する。

### Out of scope

- 記憶候補の分類prompt変更。
- UserMemory/DailyEvent repositoryの再設計。
- proactive/delegationの抽出対象化。
- Terminal版起動構成。

### Implementation notes

- 同じTurnRecordを並行処理しても重複note/eventを作らない。
- process crash時に処理中recordが永久に失われないようにする。
- 1件の失敗でbatch全体を停止しない。
- 通常logへユーザー発言全文を出さない。

### Acceptance criteria

- 新しいhuman TurnRecordがbackgroundで主要記憶へ反映される。
- worker再起動後に未処理recordを回収できる。
- 同じrecordを再処理しても重複記憶を生成しない。
- proactive/delegationを処理対象にしない。
- Discordの通常応答をworker障害で停止させない。

### Tests

- batch runner unit test
- duplicate/concurrent execution test
- failure/restart recovery test
- proactive/delegation filter test
- process wiring smoke test
- memory-system、root build/test

### Dependencies

- #14

---

## Issue 16: Discord記憶・proactiveフローのE2Eを完成し旧経路を削除する

### Background

各機能を個別に移行した後、Discord上で短期記憶、主要記憶、補助会話検索、proactive、stale responseが一つのフローとして成立することを検証し、旧wrapperとdebug出力を除去する。

元計画: [Test Plan](https://github.com/if001/chat_agent/blob/master/plans/discord-memory-orchestration.md#test-plan)

### Scope

- 短期checkpoint、Catalog、詳細検索、回答生成までのDiscord E2Eを追加する。
- 古い音楽会話、UserMemoryの言い換え、DailyEventの日付検索を検証する。
- conversation/scheduled proactiveとユーザー反応の履歴を検証する。
- checkpoint要約後もAgent起点発話とユーザー返答の関係を検証する。
- stale response再計画でmemory toolとproactiveが重複しないことを検証する。
- 移行完了後の旧repository wrapper、Conversation Analysis fixture、不要logを削除する。
- prompt/logへ機密・過剰payloadが出ないことを確認する。

### Out of scope

- Terminal版の対応。
- 新しい記憶種別。
- 汎用長期タスクAgent。
- 性能要件を超える大規模benchmark基盤。

### Implementation notes

- 外部modelを使う少数の主要E2Eと、deterministic fakeによる広いcontract testを分ける。
- `rawMarkdown`、全TurnRecord、全UserMemory、embedding、内部score、ユーザー発言全文を通常logへ出さない。
- ao/akaの共有・分離scopeを同じscenarioで確認する。

### Acceptance criteria

- 「ジャズをよく聴く」の後、多数turnを挟んだ質問から関連記憶を利用できる。
- ao/akaでUserMemory・DailyEvent・記事を共有し、checkpoint・PolicyCard・TopicStateを分離できる。
- human/proactive/delegationを同じruntimeで処理し、学習上は区別できる。
- 不要な記憶を毎requestへ注入しない。
- 旧Conversation Analysisとmain側の重複memory repositoryがDiscord経路に残らない。
- Node 23以上ですべてのbuild/testが成功する。

### Tests

- Discord主要E2E
- ao/aka scope E2E
- checkpoint compaction E2E
- proactive response journey E2E
- `npm run build:all`
- `npm run test:all`
- `git diff --check`

### Dependencies

- #13、#15
