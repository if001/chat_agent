---
name: web-ingest
description: Read a concrete URL and store it as shared knowledge for future retrieval.
---

# Web Ingest

## Goal
Ingest posted URLs into shared knowledge so future queries can reuse them.

## Process
1. Call `web_page(url)` to read title, summary, and markdown.
2. Call `save_web_knowledge(url)` to persist article content.
3. Return `articleId` and saved summary.
4. Do not persist `web_list` results directly.

## Notes
- Use `web_list` for exploration only.
- For later retrieval, prefer `search_saved_knowledge` then `get_saved_article`.
