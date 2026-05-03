import { EmbeddingProvider, PostgresKnowledgeRepository } from "./postgresKnowledgeRepository";

class FakeDb {
  public readonly calls: unknown[] = [];
  constructor(private readonly responseType: "save" | "search") {}

  async execute<T>(query: unknown): Promise<{ rows: T[] }> {
    this.calls.push(query);
    if (this.responseType === "save") {
      return {
        rows: [
          {
            id: "article_1",
            url: "https://example.com",
            title: "t",
            summary: "s",
            content: "c",
            tags: ["tag1", "tag2"],
            rawMarkdown: "m",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          } as T,
        ],
      };
    }
    if (this.responseType === "search") {
      return {
        rows: [
          {
            id: "article_1",
            url: "https://example.com",
            title: "t",
            summary: "s",
            tags: ["tag1", "tag2"],
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
  const db = new FakeDb("save");
  const repo = new PostgresKnowledgeRepository(db as never, new EmbeddingStub());

  const saved = await repo.saveArticle({
    url: "https://example.com",
    title: "t",
    summary: "s",
    content: "c",
    tags: ["tag1", "tag2"],
    rawMarkdown: "m",
  });

  expect(saved.id).toBe("article_1");
  expect(saved.tags).toEqual(["tag1", "tag2"]);
  expect(db.calls.length).toBeGreaterThan(0);
});

test("searchSavedKnowledge returns mapped items", async () => {
  const db = new FakeDb("search");
  const repo = new PostgresKnowledgeRepository(db as never, new EmbeddingStub());

  const result = await repo.searchSavedKnowledge("query");
  expect(result[0]?.articleId).toBe("article_1");
  expect(result[0]?.score).toBe(0.9);
  expect(result[0]?.tags).toEqual(["tag1", "tag2"]);
});
