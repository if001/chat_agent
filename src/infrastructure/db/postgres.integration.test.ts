import { sql } from "drizzle-orm";
import { createDrizzleClient } from "./drizzleClient";
import { createPostgresPool } from "./postgresPool";
import {
  EmbeddingProvider,
  PostgresKnowledgeRepository,
} from "./postgresKnowledgeRepository";
import { PostgresUserMemoryStore } from "../memory/postgresUserMemoryStore";

class IntegrationEmbeddingStub implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const seed = Array.from(text).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    );
    return Array.from(
      { length: 768 },
      (_, index) => ((seed + index) % 1000) / 1000,
    );
  }
}

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const integrationTest = runIntegration ? test : test.skip;

integrationTest(
  "postgres repositories persist and query real database rows",
  async () => {
    const postgresUrl = process.env.POSTGRES_URL;
    if (!postgresUrl) {
      throw new Error(
        "POSTGRES_URL is required when RUN_DB_INTEGRATION_TESTS=1",
      );
    }

    const pool = createPostgresPool(postgresUrl);
    const db = createDrizzleClient(pool);
    const repository = new PostgresKnowledgeRepository(
      db,
      new IntegrationEmbeddingStub(),
    );
    const userMemoryStore = new PostgresUserMemoryStore(db);

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const articleUrl = `https://example.com/integration/${suffix}`;
    const botId = `bot_${suffix}`;
    const userId = `user_${suffix}`;

    try {
      const saved = await repository.saveArticle({
        url: articleUrl,
        title: `Integration Title ${suffix}`,
        summary: "Integration summary",
        content: "Integration content body",
        tags: ["integration", "postgres", "search"],
        rawMarkdown: "# Integration\ncontent",
      });

      expect(saved.id.length).toBeGreaterThan(0);
      expect(saved.tags).toEqual(["integration", "postgres", "search"]);

      const byId = await repository.getSavedArticleById(saved.id);
      expect(byId?.url).toBe(articleUrl);
      expect(byId?.content).toBe("Integration content body");

      const byUrl = await repository.getSavedArticleByUrl(articleUrl);
      expect(byUrl?.id).toBe(saved.id);
      expect(byUrl?.tags).toEqual(["integration", "postgres", "search"]);

      const searchResults = await repository.searchSavedKnowledge(
        "integration postgres",
      );
      expect(searchResults.some((item) => item.articleId === saved.id)).toBe(
        true,
      );

      await userMemoryStore.rememberUserNote(
        botId,
        userId,
        "prefer direct answers",
      );
      const notes = await userMemoryStore.listUserNotes(botId, userId, 5);
      expect(notes[0]?.note).toBe("prefer direct answers");
    } finally {
      // await db.execute(sql`delete from articles where url = ${articleUrl}`);
      // await db.execute(
      //   sql`delete from user_notes where bot_id = ${botId} and user_id = ${userId}`,
      // );
      await pool.end();
    }
  },
  30000,
);
