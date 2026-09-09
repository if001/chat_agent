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
3. Fetch the analyzed body only when needed with `get_saved_article(articleId, detail="content")`; request `detail="raw"` only for source-level inspection.
4. Include `articleId` in final answers when saved knowledge is used.

## Notes
- Keep `limit` tight for focused retrieval.
- Prefer article metadata and summary before raw markdown.
