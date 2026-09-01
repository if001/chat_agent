---
name: web-ingest
description: Store a concrete URL as shared knowledge for future retrieval.
---

# Web Ingest

## Process
1. Call `save_web_knowledge(url)` once; it fetches and persists the page.
2. Return its `articleId` and saved summary.

## Notes
- Do not call `web_page` before saving the same URL.
- Do not persist search-result lists directly.
