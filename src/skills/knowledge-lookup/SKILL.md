---
name: knowledge-lookup
description: Search saved knowledge first, read summaries by default, then fetch full article only when needed.
---

# Knowledge Lookup

## Goal
Answer with minimal token usage while preserving factual traceability.

## Process
1. Use `search_saved_knowledge(query, limit, minScore)` to find candidate article IDs.
2. Evaluate results using `summary` first.
3. Fetch full body only when needed by calling `get_saved_article(articleId, includeRaw=true)`.
4. Include `articleId` in final answers when saved knowledge is used.

## Notes
- Keep `limit` tight for focused retrieval.
- Prefer article metadata and summary before raw markdown.
