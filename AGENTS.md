# Agents.md
## 概要
ローカルで実行され、1人のユーザーと長く関わり、人のように会話し、自分からも自然に話題を提供するAgentです。
同じ会話から複数のシステムが独立してユーザー像を継続的に学習します。
多数の利用者へ提供するサービスではなく、所有者本人がローカルで運用することを前提とする。
記憶には個人的な情報も保存でき、保存・修正・削除は所有者がローカルのデータと設定を直接管理する。

## プロジェクト構造
### コード
詳細は `spec/project-overview.md`を参照すること

`src/`以下にmainのAgentが存在します。フローを持つわけではなく、langchainのDeepAgentにより利用する記憶や応答を判断します。
packages以下に、Agentの機能をサポートするパッケージが存在します。これらのpackageは別々のgit repositoryとして管理されています。

- memory-system
- simple-pomdp-system
- knowledge-access
- queue

### ドキュメント
- spec/ プロジェクトの概要や設計です。
- plans/ 以下に実行計画があります。これは明示されたときに作成し、明示された時のみ参照してください。
- mid_plan/ 一時的な計画はこのディレクトリ以下に作成可能です。
- memos/ 一時的なメモはこのディレクトリ以下に作成可能です。

packages/ 以下のディレクトリも同様の構造とします。
(例 packages/xxx/spec, packages/xxx/plans, packages/xxx/mid_plan, packages/xxx/memos)

## 実行
discordのbotとして起動するのが基本の実行です。(Terminal版も存在しますがデバッグ用です。)
`run.sh`や`package.json`を参照してください。

## 禁止事項
`.env.sample` のみ参照可能です。それ以外の`.env.*`については参照は禁止です。
