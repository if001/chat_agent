import { EmbeddingProvider, PostgresKnowledgeRepository, Queryable, QueryResultRow } from "./postgresKnowledgeRepository";

class FakeDb implements Queryable {
  public readonly calls: Array<{ sql: string; params?: unknown[] }> = [];

  async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });

    if (sql.includes("RETURNING id")) {
      return {
        rows: [
          {
            id: "article_1",
            url: "https://example.com",
            title: "t",
            summary: "s",
            raw_markdown: "m",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          } as T,
        ],
      };
    }

    if (sql.includes("1 - (embedding <=>")) {
      return {
        rows: [
          {
            id: "article_1",
            url: "https://example.com",
            title: "t",
            summary: "s",
            score: 0.9,
          } as T,
        ],
      };
    }

    return { rows: [] };
  }
}

class EmbeddingStub implements EmbeddingProvider {
  async embed(): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}

test("saveArticle uses embedding and upsert", async () => {
  const db = new FakeDb();
  const repo = new PostgresKnowledgeRepository(db, new EmbeddingStub(), 3);

  const saved = await repo.saveArticle({
    url: "https://example.com",
    title: "t",
    summary: "s",
    rawMarkdown: "m",
  });

  expect(saved.id).toBe("article_1");
  expect(db.calls.some((call) => call.sql.includes("ON CONFLICT (url) DO UPDATE"))).toBe(true);
});

test("searchSavedKnowledge returns mapped items", async () => {
  const db = new FakeDb();
  const repo = new PostgresKnowledgeRepository(db, new EmbeddingStub(), 3);

  const result = await repo.searchSavedKnowledge("query");
  expect(result[0]?.articleId).toBe("article_1");
  expect(result[0]?.score).toBe(0.9);
});
