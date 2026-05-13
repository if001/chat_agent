---
name: daily-events
description: Save and retrieve concise day-by-day user activity records.
---

# Daily Events

## Goal
Track short factual records of what the user did on specific dates, then reuse them when the user asks about dates or past activities.

## Save
1. When the conversation includes a concrete user action worth remembering, call `remember_daily_event`.
2. Keep the summary short and factual.
3. Add a small tag list when it improves later retrieval.

## Read
1. If the user asks what they were doing around a date, use `get_daily_events_by_date`.
2. If the user asks when they did something, use `search_daily_events`.
3. Prefer saved daily events before guessing from recent chat history.

## Notes
- Do not store every utterance.
- Save actions, decisions, milestones, and changes that are likely to matter later.
