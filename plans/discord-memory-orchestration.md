# Discord response agent・記憶検索・proactive入力統合計画

## 目的

Discord版のresponse agentを、現在の入力と短期会話状態を踏まえて必要な記憶を自ら選び、DeepAgentの複数stepとtool callで取得して回答する構成へ整理する。Agentには利用可能な記憶種別を静的に知らせ、必要な場合は軽量なMemory Catalogで保存領域を確認してから詳細検索する二段階探索を採用する。

永続化と検索の具体的な仕組みはmemory-systemへ集約する。simple-pomdp-systemは自発的な話題の機会と内容を判断し、その結果を通常のresponse agentへ入力として提供する。通常応答とproactive応答に別の生成pipelineは作らず、同じDeepAgent runtimeを利用する。

Terminal版は今回の対象外とし、Discord版の完了後に別途判断する。既存の`memory-and-proactive-agent-simplification.md`と`conversational-autonomy-and-shared-knowledge.md`は設計履歴として残す。

## 現状の整理

### 実現できているため維持するもの

- ユーザーに見える会話はmain側から共通のTurnRecord repositoryへ1回だけ保存される。
- memory-systemとsimple-pomdp-systemは同じTurnRecordを参照し、独自の会話履歴を正本として複製しない。
- Discord版のLangGraph checkpointは`botId + threadId`で分離され、同一threadの短期message stateとrun再開に利用される。
- UserMemory、DailyEvent、保存記事はao/akaで共有される。
- Episode、PolicyCard、TopicState、InteractionLog、checkpointはbot別に分離される。
- UserMemoryの明示的な保存、検索、置換、削除と、矛盾noteを増やさないwrite plannerが存在する。
- conversationVersionによるstale response破棄と、TurnKind/sourceInteractionIdによる会話種別・proactive反応の追跡が存在する。
- 保存記事はao/aka双方から検索でき、proactive候補にも利用できる。
- Request Contextにはsection単位の上限があり、記事本文やraw markdownを常時注入しない。

### 実現できていないため今回対応するもの

- response agentが「どの記憶が必要か」を判断していない。main側の`RequestContextBuilder`が毎requestでUserMemoryとPolicyCardを先に検索している。
- UserMemoryとDailyEventの本番検索は入力全文の`ILIKE`に依存し、言い換えや関連概念を取得できない。
- 直近範囲から外れたTurnRecordを、現在入力との関連性で検索する公開機能がない。
- 継続会話から安定した好みや制約をUserMemory候補としてbackground抽出する第二段階がない。
- memory-systemの保存・検索機能がmain側のPostgres repository、tool、clientへ分散している。
- simple-pomdp-systemを呼ぶ前にmain側の`createConversationAnalysisService`が話題完了とconversation trigger可否を判定しており、initiative判断が二重化している。
- `Conversation Focus`を作るために通常回答前に追加のLLM呼び出しが発生し、その結果がDeepAgent自身の推論と重複する。
- 過去の会話を覚えていること、言い換えによる検索、再起動後の想起を保証するDiscord E2Eがない。
- checkpointは直近N件へ常時制限されていない。現在のDeepAgent 1.7.0は既定で約170,000 token到達時に会話を要約し、直近6 messagesを保持するため、使用modelのcontext上限とinteraction単位に合わせた管理が必要である。
- checkpoint上のproactive疑似Human入力にはTurnRecordの`kind`相当の識別がなく、次回の会話で実ユーザー入力と誤認される可能性がある。

### 今回は不要または保留とするもの

- Terminal版のcheckpoint永続化、記憶tool、context構築の変更は保留する。
- 汎用的なgoal decomposition、長期project実行、自己改変、包括的approval frameworkは追加しない。
- memory-system内にresponse agentやplannerを作らない。memory-systemは保存・検索・派生処理を提供し、回答方針は決めない。
- simple-pomdp-systemへUserMemory、DailyEvent、保存記事の正本を複製しない。
- 毎requestで全種類の記憶を自動取得しない。
- checkpointの全messagesをRequest Contextへ重複注入しない。
- UserMemoryへ一時的な話題、日付付き出来事、proactive反応、応答戦略を混在させない。

## 責務の境界

### Discord response agent

答える問い:

> 現在の入力へ応答するために、どの情報を取得し、どのtoolをどの順で利用するか。

責務:

- checkpointから復元された短期会話と現在入力を読む。
- system promptに記載された利用可能な記憶種別を理解する。
- 過去、好み、予定、保存情報などが関係し得る場合はMemory Catalogを確認する。
- 入力種別と利用可能な記憶toolを確認する。
- 過去会話、UserMemory、DailyEvent、PolicyCard、保存記事のうち必要なものだけ検索する。
- 検索結果が不足していればqueryを修正して追加検索する。
- tool結果を根拠に回答を生成する。
- proactive内部指示も同じ実行経路で自然なユーザー向け発話へ変換する。

### memory-system

答える問い:

> 指定された種類とqueryに対して、保存済み記憶のうち何が関連するか。

責務:

- TurnRecordの保存と直近取得。
- 保存されている記憶領域と代表topicを示す軽量なMemory Catalogの生成。
- 関連する過去TurnRecordの検索。
- UserMemoryの保存、検索、置換、削除。
- DailyEventの保存と検索。
- Episode、PolicyCardの生成と検索。
- embedding、全文検索、ranking、重複除去、件数制限など取得方法の隠蔽。
- 継続会話からのUserMemory候補抽出と既存noteとの照合。

memory-systemは「今回UserMemoryを検索すべきか」を決めない。response agentまたはsimple-pomdp-systemから指定されたscopeとqueryに従って結果を返す。

### simple-pomdp-system

答える問い:

> 自発的な話題を加える機会か。機会であれば、どの方向の話題を提供するか。

責務:

- conversation triggerについて、現在の会話が進行中、訂正、確認、処理途中かを判断する。
- conversation triggerが実行可能な場合にだけ`explore / refine / exploit`を選ぶ。
- scheduled triggerでは外部schedulerから起動された後に話題を選ぶ。
- TopicStateとInteractionLogを更新する。
- 必要な過去会話やUserMemoryをmemory-systemの読み取りAPIから取得する。
- 必要な保存記事をknowledge-accessから取得する。
- response agentへ短い内部指示、根拠ID、sourceInteractionIdを返す。
- conversation triggerでは候補を提供し、最終回答へ実際に含めるかは回答状況を知るresponse agentへ委ねる。

conversation triggerの不実行は、話題選択結果の`do_nothing`として扱わない。次の二段階に分ける。

1. `assessConversationOpportunity`: proactive情報を追加できるか判定する。
2. 実行可能な場合だけ`planInteraction`: `explore / refine / exploit`を必ず選ぶ。

## 統一する実行フロー

### 入力envelope

通常入力とproactive入力は同じresponse agentへ渡し、別pipelineを作らない。違いは型付きの入力メタデータとして提供する。

```ts
type ResponseInputOrigin = "human" | "proactive" | "delegation";

interface ResponseInputEnvelope {
  origin: ResponseInputOrigin;
  botId: string;
  userId: string;
  threadId: string;
  content: string;
  sourceInteractionId?: string;
  proactive?: {
    trigger: "conversation" | "scheduled";
    intent: string;
    evidenceIds: string[];
  };
}
```

- `human`: 実ユーザー入力。checkpointの短期履歴を使い、必要な記憶をtoolで取得する。
- `proactive`: simple-pomdpが作った内部指示を現在と同じくuser message相当で入力する。ただし`origin`を保持し、ユーザーの嗜好や発言として学習しない。
- `delegation`: ao/aka間の依頼。ユーザー発言としてUserMemoryやTopicStateへ学習しない。
- conversation triggerで選ばれた話題は、実ユーザー入力と同じresponse runへ補助情報として渡し、追加messageを生成しない。
- conversation triggerの候補は、確認質問、訂正、tool失敗、未完了作業などを踏まえてDeepAgentが最終回答へ採用しないこともできる。これはsimple-pomdp plannerの`do_nothing`ではなく、response agentによる文章構成判断である。
- scheduled triggerは内部指示を1件のresponse inputとしてqueueへ送り、同じDeepAgent runtimeで発話へ変換する。
- proactive疑似Human入力は空文字へ変換せず、Agent発話の原因としてcheckpointとTurnRecordへ保持する。checkpoint message metadataにも`origin: proactive`を保持する。

### human入力

1. Discord queue taskのconversationVersionを確認する。
2. 必要ならsimple-pomdp-systemの`assessConversationOpportunity`を呼び、追加可能な場合だけ話題計画を得る。
3. human inputと任意のproactive補助情報を1つの`ResponseInputEnvelope`へまとめる。
4. DeepAgentを同じ`botId + threadId` checkpointで開始する。
5. DeepAgentが現在入力と短期messagesから必要な記憶scopeを判断する。
6. 記憶が関係し得る場合はMemory Catalogを取得し、候補領域を確認する。
7. DeepAgentが必要なmemory toolまたはknowledge toolを0回以上呼ぶ。
8. 取得結果を使って1件の応答を生成する。
9. staleなら送信せず、最新入力へ1回だけ再計画する。
10. 送信成功後にTurnRecordへ1回記録する。

### scheduled proactive入力

1. schedulerがsimple-pomdp-systemを起動する。
2. simple-pomdp-systemがTopicState、InteractionLogと必要な外部情報を読み、話題を1件選ぶ。
3. 内部指示、trigger、根拠ID、sourceInteractionIdをqueue taskへ保存する。
4. Discord workerが`origin: proactive`の`ResponseInputEnvelope`を作る。
5. human入力と同じDeepAgent runtimeへ渡す。
6. DeepAgentが必要ならmemory/knowledge toolを追加で呼び、自然な発話を1件生成する。
7. 送信成功後に`kind: proactive`のTurnRecordを保存する。

## memory-system公開境界

main側にPostgres検索実装を露出させず、Discord runtimeとsimple-pomdp-systemはmemory-system clientだけを利用する。

```ts
type MemoryScope =
  | "conversation_history"
  | "user_memory"
  | "daily_events"
  | "policy_cards";

interface MemoryCatalogRequest {
  botId: string;
  threadId: string;
  userId: string;
  query?: string;
}

interface MemoryCatalogEntry {
  available: boolean;
  topics: string[];
  updatedAt?: string;
  dateRange?: { from?: string; to?: string };
}

interface MemoryCatalog {
  status: "available" | "unavailable";
  userMemory: MemoryCatalogEntry;
  dailyEvents: MemoryCatalogEntry;
  policyCards: MemoryCatalogEntry;
  conversationHistory: MemoryCatalogEntry;
}

interface MemorySearchRequest {
  botId: string;
  threadId: string;
  userId: string;
  query: string;
  scopes: MemoryScope[];
  limits?: Partial<Record<MemoryScope, number>>;
}

interface MemorySearchResult {
  conversationHistory: Array<{
    turnRecordId: string;
    occurredAt: string;
    excerpt: string;
  }>;
  userMemory: Array<{
    noteId: number;
    note: string;
  }>;
  dailyEvents: Array<{
    eventId: number;
    eventDate: string;
    summary: string;
  }>;
  policyCards: Array<{
    policyCardId: string;
    appliesWhen: string;
    recommendedBehavior: string;
    avoidBehavior?: string;
  }>;
}

interface MemoryService {
  recordTurn(input: TurnRecord): Promise<void>;
  inspectCatalog(input: MemoryCatalogRequest): Promise<MemoryCatalog>;
  search(input: MemorySearchRequest): Promise<MemorySearchResult>;
  rememberUserMemory(input: UserMemoryWriteInput): Promise<UserMemoryWriteResult>;
  replaceUserMemory(input: UserMemoryReplaceInput): Promise<UserMemoryWriteResult>;
  deleteUserMemory(input: UserMemoryDeleteInput): Promise<boolean>;
  rememberDailyEvent(input: DailyEventWriteInput): Promise<DailyEvent>;
}
```

Memory Catalogは記憶本文や件数だけの一覧ではなく、各領域の有無、短い代表topic、更新時刻、DailyEventの期間だけを返す。新しい正本にはせず、各記憶と検索indexから再生成可能な派生データとする。

保存記事はmemory-systemのCatalogへ複製しない。knowledge-accessに同形の軽量な`inspectKnowledgeCatalog`を設け、response agent向けの`inspect_context_catalog` toolがmemory-systemとknowledge-accessのCatalogを集約して返す。各serviceの取得失敗は領域ごとに`unavailable`として表現する。

公開結果にはembedding、内部score、raw conversation JSON、不要なbot scopeを含めない。検索scopeごとに既定上限を持ち、空sectionは返さない。検索失敗と該当なしを区別するため、詳細検索も`found / not_found / unavailable`を返す。

## DeepAgentへ提供するmemory tools

DeepAgentに巨大なmemory payloadを事前注入せず、利用可能な記憶種別だけをsystem promptで常時知らせる。過去、ユーザー自身、好み、予定、保存情報が関係し得る場合は、次の軽量toolから探索を開始する。

- `inspect_context_catalog(query?)`: memory-systemのUserMemory、DailyEvent、PolicyCard、過去会話と、knowledge-accessの保存記事について代表topicと利用可否を取得する。

Catalog確認後、必要に応じて以下を呼ばせる。

- `search_conversation_memory(query, limit)`: 関連する過去会話の短いexcerptを取得する。
- `search_user_memory(query, limit)`: 安定した好み、制約、継続的な前提を取得する。
- `search_daily_events(query, dateRange?, limit)`: 日付付き出来事を取得する。
- `search_response_policies(query, limit)`: 類似状況の応答方針を取得する。
- 既存のUserMemoryとDailyEventの明示的な書き込みtoolは維持する。
- 保存記事はknowledge-accessの`search_saved_knowledge`と`get_saved_article`を利用する。

toolはruntime contextから`botId / threadId / userId`を取得し、LLMにscope識別子を指定させない。tool説明には利用条件と非対象を短く明記する。

- 過去に話した内容、以前の発言への言及: conversation memory
- 安定した好み、制約、継続作業の前提: UserMemory
- いつ、昨日、先週、予定、特定日: DailyEvent
- どう応答するとよいか: PolicyCard
- 保存・共有した記事: knowledge-access

挨拶、単純な相槌、現在の短期messagesだけで十分な質問ではmemory toolを呼ばない。

Memory Catalogも毎requestの必須toolにはしない。harnessには次の大まかな行動方針だけを置く。

- ユーザー自身、過去、以前の会話、予定、好み、保存情報が回答に関係し得る場合はCatalogを確認する。
- 現在の短期会話だけで確実に回答できる場合は確認しない。
- Catalogに候補がある場合だけ詳細検索する。
- `unavailable`を「記憶が存在しない」と解釈しない。
- `not_found`で記憶が回答の前提になる場合は、queryを一度だけ言い換えられる。

## 関連記憶検索

検索の主経路はUserMemory、PolicyCard、DailyEventとする。TurnRecord検索は、派生記憶に残すべきでない具体的な過去会話や、派生記憶の根拠を補うために利用する。

### TurnRecord

- TurnRecordを正本のまま維持する。
- user/assistant本文から検索用embeddingを作り、TurnRecord IDに関連付けた派生indexをmemory-system内に持つ。
- `botId + threadId`をruntime contextから固定して検索し、proactive/delegationを実ユーザー発言として扱わない。
- 現在のTurnRecordには`userId`が存在しないため、単一ユーザー運用では追加しない。複数ユーザーまたはuser横断検索が必要になった場合だけ明示的なuser scope追加を再検討する。
- queryに加えて任意の`from / to`、`roles`、`kinds`、`limit`を受け付ける。bot/threadはLLMに指定させない。
- embedding textにはkindとrole labelを含め、Agent自身の発言をユーザーの好みとして誤認しにくくする。
- 検索結果は会話全文ではなく、日時、短いexcerpt、TurnRecord IDだけを返す。
- checkpointに存在する直近turnと検索結果が重複する場合は除外する。

### UserMemory

- 入力全文の`ILIKE`を主検索として使用しない。
- note embeddingによる意味検索を主とし、短い語句の全文検索を補助にする。
- UserMemoryはuserId scopeで共有し、botIdを検索条件にしない。
- 書き込み前に意味的な近傍noteを取得し、create/keep/replace/deleteを既存write plannerで決める。

### DailyEvent

- userId scopeで共有し、botIdを公開型とDBから除去する。
- 日付条件は構造化filter、内容は意味検索または全文検索で取得する。
- 日付なしの曖昧な質問でも、agentが必要と判断した場合はquery検索できる。

### PolicyCard

- botId別を維持する。
- response agentが必要と判断した場合に限り最大3件取得する。
- appliesWhen、recommendedBehavior、avoidBehaviorだけをtool結果へ返す。
- Episode本文や根拠会話全文は通常回答へ渡さない。

## checkpoint短期履歴の管理

現在のDeepAgent 1.7.0は約170,000 tokenでsummarizationを開始し、直近6 messagesを残す既定値を持つ。これは直近12 TurnRecordのConversation Focusとは別経路であり、直近N interaction制限ではない。

- 使用するOllama modelのcontext上限を起動時に把握し、それより十分手前で要約を開始する。
- 保持単位は単純なmessage数ではなく、`{入力, Agent応答}`のinteractionを基本にする。
- 要約後も設定された直近N interactionsと現在進行中のtool stateを残す。
- 大きなtool結果は次turnへ全文を残さず、必要な結果と参照IDだけに圧縮する。
- 会話要約はcheckpoint内の短期派生状態であり、TurnRecordの正本へ上書きしない。
- proactive interactionを削除したり疑似Human入力を空にしたりせず、originとAgent起点であることを要約へ残す。
- DeepAgent既定summarizationとcustom summarizationを二重適用しない。設定可能な公開APIを確認し、設定できない場合はagent生成層の変更を検討する。

proactive TurnRecordの監査・再現用表現は維持する。

```text
[{ Human(origin=proactive), Agent }, { Human(origin=human), Agent }]
```

通常会話のために履歴を再提示・要約するときは、raw内部指示を実ユーザー発言として表示せず、次の意味へ整形する。

```text
[Assistant initiated]
Agentが実際にユーザーへ送った発話

[User]
それに対する実ユーザーの返答
```

raw proactive instructionはTurnRecordに保持し、学習、検索、会話contextでは`kind`とmessage metadataに基づいて区別する。

## `createConversationAnalysisService`の廃止

`src/infrastructure/agent/conversationFocus.ts`と`createConversationAnalysisService`を削除する。

移管先:

| 現在の判定 | 移管先 |
|---|---|
| currentTopic | DeepAgentのcheckpoint短期会話、またはmemory search |
| unresolvedQuestion | DeepAgentの短期会話推論 |
| agentCommitment | DeepAgentの短期会話推論。将来実行はqueue作成成功時のみ約束可能 |
| resumableTopic | DeepAgentのconversation memory検索 |
| currentTopicStatus | simple-pomdpのconversation opportunity判定 |
| conversationTrigger | simple-pomdpのconversation opportunity判定 |

削除対象:

- `ConversationAnalysisService`、`ConversationAnalysis`、`ConversationFocus`型。
- `formatConversationFocus`とRequest ContextのConversation Focus section。
- `DiscordBotApp.analyzeConversation`。
- `DiscordBotApp.planConversationTopic`のanalysis依存。
- `runDiscord.ts`のconversation analysis model生成とDI。
- analyzer専用unit testとfixture。

未解決質問やagentの約束を別の永続モデルへ移さない。まずcheckpointの短期messagesからDeepAgentが扱う。古くなっても必要な情報はTurnRecord関連検索またはUserMemoryへ昇格させる。

## Request Contextの縮小

現在の`RequestContextBuilder`によるUserMemory、DailyEvent、PolicyCard、記事の先行検索を廃止する。

DeepAgent invocation時に常時渡す情報は次に限定する。

- 現在日時。
- 入力origin。
- botIdに対応する人格と静的ルール。
- proactiveの場合のtrigger、短いintent、根拠ID。
- stale response、内部指示をユーザー事実として学習しない等の恒久的な実行規則。

UserMemory、DailyEvent、PolicyCard、過去会話、保存記事はMemory Catalogと詳細toolの結果としてのみ追加する。これにより、main側のregexによる取得判断と、DeepAgentによる取得判断の二重化を防ぐ。

## background記憶抽出

第一段階では検索経路を完成させ、明示的な記憶操作を維持する。その後、第二段階としてbackground観察を追加する。

- 新しいhuman TurnRecordだけを対象にする。
- proactive/delegationの内部指示をユーザーの事実として抽出しない。
- 安定した好み、制約、継続作業の前提だけをUserMemory候補にする。
- 日付付き出来事はDailyEvent候補に送り、UserMemoryへ複製しない。
- 一時的な話題や弱い興味推定は保存しない。
- 既存noteの意味検索後にcreate/keep/replace/deleteを選ぶ。
- processed TurnRecord IDを利用して冪等化し、worker再起動後も再処理できるようにする。
- TopicStateとPolicyCardへの保存判断はそれぞれsimple-pomdp-systemとprocedural memory処理へ任せる。

## 実装フェーズ

### Phase 0: Discordの現状を固定する

- 同一threadの2回目の応答でcheckpoint上の直前会話を参照できるE2Eを追加する。
- 12件より古い音楽会話を現在は想起できないことを再現するテストを追加する。
- UserMemoryの言い換え検索が失敗する本番repositoryテストを追加する。
- conversation trigger、scheduled proactive、stale response、TurnRecord 1回保存の既存挙動をfixture化する。
- DeepAgentの既定summarizationが約170,000 token・直近6 messagesであることと、使用modelのcontext上限を記録する。

### Phase 1: memory-systemへ読み書き境界を集約する

- main側のUserMemory/DailyEvent repository公開利用をmemory-system clientへ移す。
- `MemoryService.search`とscope別resultを追加する。
- `MemoryService.inspectCatalog`と再生成可能なCatalog indexを追加する。
- PolicyCard検索を同じclient境界へ統合する。
- simple-pomdpのTurnRecord/UserMemory source adapterをmemory-system client adapterへ置換する。
- scope、bot分離、共有範囲のcontract testを追加する。

### Phase 2: 意味検索を実装する

- TurnRecord検索用の派生embedding indexを追加する。
- UserMemory noteへembedding検索を追加する。
- DailyEventへ日付filterと意味検索を追加する。
- index生成失敗時も正本データを壊さず、未index対象を再処理できるようにする。
- 内部scoreはrepository内の順位付けにだけ使用する。

### Phase 3: memory toolsでDeepAgentへ判断を移す

- scope別memory toolをmemory-system client上に実装する。
- memory-systemの`inspectCatalog`とknowledge-accessの`inspectKnowledgeCatalog`を集約する`inspect_context_catalog`を追加し、詳細検索との二段階探索をsystem promptへ記載する。
- `RequestContextBuilder`の記憶先行取得を削除し、runtime metadata formatterへ縮小する。
- system promptへ記憶種別の意味とtool選択条件を追加する。
- 同じ記憶を複数tool結果やcheckpointから重複注入しない。
- tool loop回数と各結果の件数・文字数に上限を設定する。
- `found / not_found / unavailable`をtool結果で区別する。

### Phase 3.5: checkpoint contextを管理する

- 使用modelのcontext上限に合わせてsummarization triggerを設定する。
- 直近N interactions、短い会話要約、実行中tool stateを残す。
- proactive疑似Human messageへorigin metadataを付ける。
- 要約時にhuman/proactive/delegationの区別を維持する。
- proactive内部指示を空にせず、通常会話contextではAgent起点の発話として整形する。

### Phase 4: conversation analysisをsimple-pomdpへ移す

- simple-pomdpへ`assessConversationOpportunity`を追加する。
- conversation trigger時は現在入力を含む短期文脈をmemory-systemから取得する。
- 不実行理由とplannerの`explore/refine/exploit`を別型にする。
- Discord側の`createConversationAnalysisService`依存を削除する。
- conversation triggerの話題をhuman response runへ統合する。
- simple-pomdpが返したconversation候補を最終回答へ採用するかはDeepAgentが判断する。

### Phase 5: 入力envelopeと生成経路を統一する

- human/proactive/delegationを`ResponseInputEnvelope`で表現する。
- Discordのmentionとagent_inputを共通response実行関数へ寄せる。
- originに応じたTurnKind、sourceInteractionId、学習除外規則を維持する。
- proactive内部指示を通常ユーザー発言としてUserMemory抽出しないことをテストする。

### Phase 6: background UserMemory観察を追加する

- human TurnRecordから保存候補を抽出するworkerをmemory-systemへ追加する。
- UserMemory/DailyEvent/保存しない、の分類を行う。
- 意味的重複と訂正を既存write plannerで処理する。
- workerをDiscord運用の起動構成へ追加し、失敗回収と冪等性を検証する。

## Test Plan

- Discordの同一bot/threadではcheckpointから直前の会話を参照できる。
- aoとakaのcheckpointとTurnRecord検索結果が混線しない。
- 「ジャズをよく聴く」の後、多数のturnを挟んで「前の音楽の話を覚えている？」から関連TurnRecordを取得できる。
- 「ジャズが好き」というUserMemoryを「どんな音楽が好みだった？」で取得できる。
- 日付付き出来事を言い換えとdate rangeで取得できる。
- 挨拶や現在の短期文脈だけで回答できる入力ではmemory toolを呼ばない。
- 過去やユーザー情報が関係する入力では詳細検索前にMemory Catalogを確認する。
- Memory Catalogが本文や内部scoreを含まず、保存領域と代表topicだけを返す。
- Catalogまたは詳細検索の`unavailable`を`not_found`として扱わない。
- 過去会話への言及ではconversation memory toolが呼ばれる。
- 安定した好みへの質問ではUserMemory toolが呼ばれる。
- 日時・予定への質問ではDailyEvent toolが呼ばれる。
- response agentが必要に応じて複数のmemory toolを順番に呼べる。
- tool結果が空なら記憶が存在すると捏造せず、必要ならqueryを1回修正する。
- conversation opportunityの不実行が`do_nothing`としてTopicStateへ保存されない。
- conversation opportunityが実行可能な場合、simple-pomdpは必ず`explore/refine/exploit`を返す。
- conversation triggerで選ばれた話題は通常回答と同じmessageに統合される。
- conversation trigger候補が確認質問、訂正、失敗時には最終回答へ無理に追加されない。
- scheduled proactiveはhumanと同じDeepAgent runtimeを利用する。
- proactive interactionが`{Human(origin=proactive), Agent}`として保持され、疑似Human入力が空に置換されない。
- checkpoint要約後も、Agent起点の発話とそれに対する実ユーザー返答の関係が維持される。
- proactive/delegation入力からUserMemoryやDailyEventが自動生成されない。
- background観察で同義UserMemoryが増殖せず、訂正後に古いnoteが検索されない。
- stale response破棄後の再計画でmemory toolとproactive発話が重複実行されない。
- promptと通常logへ全TurnRecord、全UserMemory、rawMarkdown、embedding、検索scoreを出さない。
- Node 23以上で`build:all`、`test:all`、Discord主要E2Eが成功する。

## 完了条件

- response agentが現在入力とcheckpoint短期会話から必要な記憶種別を選び、DeepAgent tool loopで取得して回答する。
- response agentが必要時にMemory Catalogを確認し、存在する記憶領域から詳細検索を選べる。
- memory-systemが会話履歴、UserMemory、DailyEvent、PolicyCardの保存・検索方法を隠蔽する唯一の公開境界になる。
- simple-pomdp-systemだけがconversation triggerの機会判定と話題選択を担当する。
- `createConversationAnalysisService`とConversation Focusの事前LLM処理がDiscord実行経路からなくなる。
- human/proactive/delegationが同じresponse runtimeを使い、型付きoriginで学習と永続化を正しく分離する。
- 直近範囲外の過去会話と言い換えられた長期記憶をDiscord上で取得できる。
- 不要な記憶を毎requestへ事前注入しない。
- checkpointが使用modelのcontext上限より前に圧縮され、直近interactionとproactiveの起点を失わない。
- Terminal版に変更を加えなくてもDiscord版のbuildとtestが成立する。

## Assumptions

- 対象は1人のユーザーがローカル運用するDiscord agentである。
- DiscordのPostgres checkpointは短期message stateとrun再開に限定する。
- TurnRecordは永続会話履歴の正本であり、embedding indexは再生成可能な派生データとする。
- DeepAgentは複数stepとtool callを実行でき、記憶取得の要否を推論できる。
- proactive内部指示をuser role相当で入力する既存方式は維持するが、`origin`によって実ユーザー入力と区別する。
- UserMemory、PolicyCard、DailyEventを主要な派生記憶とし、TurnRecord検索は具体的な過去会話を補う経路とする。
- conversation triggerの機会判定はplannerの話題選択とは別工程であり、`do_nothing`を復活させない。
- 保存記事の永続化と検索はknowledge-accessの責務を維持し、memory-systemへ複製しない。
