---
name: user-memory
description: Explicitly save, search, correct, or delete stable user preferences and working context.
---

# User Memory

## Goal
Keep stable or semi-stable user context so future responses match the user's preferences, working style, and ongoing tendencies.

## Save
1. Save only when the user explicitly asks to remember reusable context.
2. Search with `search_user_notes` before saving.
3. If an equivalent note already exists, do not add another note.
4. Save short statements that remain useful beyond the current single message.
5. Prefer generalized memory over one-off event logs.

## Correct or Delete
1. Search for the existing note and use the returned ID.
2. For an explicit correction, call `replace_user_note(noteId, note)`; do not append a contradictory note.
3. For an explicit deletion, call `delete_user_note(noteId)`.
4. Never guess an ID or delete solely from an LLM interpretation.

## Read
1. Before answering in a way that depends on user preference or context, call `search_user_notes`.
2. Reuse saved notes to keep response style and proposals consistent.
3. If saved notes conflict, prefer the more recent note and mention the assumption when needed.

## Store Here
- Response style preferences
- Technical preferences and constraints
- User policies and decision criteria
- Short-term tendencies that may matter across the current phase of work
- Long-term tendencies and stable profile facts

## Do Not Store Here
- Date-specific event logs
- One-off actions that are only relevant as history
- Proactive-topic interest or reaction evidence; that belongs to TopicState
- Agent response strategies; those belong to PolicyCard
- Verbose transcripts of the conversation

## Boundary With Daily Events
- `user-memory` answers: what kind of user they are, what they prefer, how they are currently approaching work
- `daily-events` answers: what they did on a certain date or around a certain date
- Notes are shared by `ao` and `aka` for the same user; do not create bot-specific copies.
