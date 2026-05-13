---
name: user-memory
description: Save and retrieve user preferences, tendencies, profile, and medium-term or long-term working context.
---

# User Memory

## Goal
Keep stable or semi-stable user context so future responses match the user's preferences, working style, and ongoing tendencies.

## Save
1. When the conversation reveals a reusable preference, policy, attribute, working style, or ongoing tendency, call `remember_user_note`.
2. Save short statements that remain useful beyond the current single message.
3. Prefer generalized memory over one-off event logs.

## Read
1. Before answering in a way that depends on user preference or context, call `get_user_notes`.
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
- Verbose transcripts of the conversation

## Boundary With Daily Events
- `user-memory` answers: what kind of user they are, what they prefer, how they are currently approaching work
- `daily-events` answers: what they did on a certain date or around a certain date
