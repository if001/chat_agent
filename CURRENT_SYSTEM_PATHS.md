# Current conversation, memory, and proactive paths

This is a characterization of current behavior, not a target architecture.

## Scenarios and coverage

| Scenario | Current behavior | Coverage |
| --- | --- | --- |
| Multi-turn conversation | Tasks run sequentially; every successful visible reply calls the recorder once with one user/assistant pair. | `src/ui/discord/discordBotApp.test.ts` |
| Input during generation | Later input remains queued until the active response finishes. | `src/ui/discord/discordBotApp.test.ts` |
| Proactive → human reaction → belief | The next dispatch classifies human turns after a pending interaction and updates its log and belief. | `packages/simple-pomdp-system/tests/service.test.ts` |
| UserMemory correction/delete/duplicate | `user_notes` is append-only. Such text is literal and identical notes are retained; no correction/delete API exists. | `src/infrastructure/memory/postgresUserMemoryStore.test.ts` |
| Conversation/scheduled triggers | Each call creates one queue task; conversation routes to `channel:user`, scheduled to `channel:scheduled`. | `src/queue/queueApi.characterization.test.ts` |

Tests fake the LLM, transport, queue store, and clock.

## TurnRecord copies

A successful reply calls `DiscordBotApp.recordTurn` once. The callbacks in `src/runDiscord.ts` and `src/runTerminal.ts` send that record to both:

1. memory-system → one PostgreSQL `app.memory_turn_records` row.
2. simple-pomdp-system → one `turn-records/<botId>.json` entry under its configured store.

Thus one visible turn currently has one callback and two physical TurnRecord copies. LangGraph checkpoints are separate execution state.

## Persistent data

| Data | Store | Use |
| --- | --- | --- |
| Articles/embeddings | PostgreSQL `articles` | Knowledge tools and proactive research. |
| User notes | PostgreSQL `user_notes` | Memory tools; append-only, bot-scoped. |
| Daily events | PostgreSQL `daily_events` | Daily-event tools. |
| TurnRecords | PostgreSQL `app.memory_turn_records` | Memory episode/policy processing. |
| Chunks / episodes / policy cards | PostgreSQL `app.memory_conversation_chunks`, `app.memory_episode_cases`, `app.memory_policy_cards` | Background processing and prompt policy lookup. |
| simple-pomdp TurnRecords | JSON per bot | Planning/reaction observation; duplicates PostgreSQL TurnRecords. |
| Beliefs / interaction logs | simple-pomdp JSON files | Proactive planning and belief updates. |
| Main queue | JSON per bot | Mention and agent-input delivery. |
| simple-pomdp debug log | Optional JSONL | Diagnostics only. |
| LangGraph checkpoint/store | PostgreSQL `app` | Agent execution state, not TurnRecords. |

## Queue payloads

Every task has `id,type,action,text,channelId,targetThreadId,source,dueAt,createdAt,locked`; recurring tasks add `intervalMinutes`. Mentions add `authorId,mentionsBot`. Conversation proactive tasks use `action=agent_input,source=simple_pomdp,targetThreadId=channel:user`; scheduled tasks use `action=agent_input,source=scheduled,targetThreadId=channel:scheduled`.

The simple-pomdp sink deduplicates `sourceInteractionId` only in a process-local cooldown map. The ID is absent from the resulting queue task and TurnRecord, and restart clears the guard.
