import { eq, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { KnowledgeRepository, SavedArticle, SearchKnowledgeOptions, SearchResultItem } from "../../core/types";
import { articlesTable } from "./schema";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

interface SearchRow {
  id: string;
  url: string;
  title: string;
  summary: string;
  score: number;
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    const embedding = await this.embeddingProvider.embed(`${article.title}\n${article.summary}\n${article.rawMarkdown}`);
    const id = `article_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const result = await this.db.execute(
      sql`
      INSERT INTO articles (id, url, title, summary, raw_markdown, embedding)
      VALUES (${id}, ${article.url}, ${article.title}, ${article.summary}, ${article.rawMarkdown}, ${toVectorLiteral(embedding)}::vector)
      ON CONFLICT (url) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        raw_markdown = EXCLUDED.raw_markdown,
        embedding = EXCLUDED.embedding
      RETURNING id, url, title, summary, raw_markdown as "rawMarkdown", created_at as "createdAt"
      `,
    );
    const row = result.rows[0] as SavedArticle | undefined;
    if (!row) {
      throw new Error("Failed to save article");
    }
    return {
      ...row,
      createdAt: new Date(row.createdAt),
    };
  }

  async getSavedArticleById(articleId: string): Promise<SavedArticle | null> {
    const rows = await this.db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, articleId))
      .limit(1);
    return mapSavedArticle(rows[0]);
  }

  async getSavedArticleByUrl(url: string): Promise<SavedArticle | null> {
    const rows = await this.db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.url, url))
      .limit(1);
    return mapSavedArticle(rows[0]);
  }

  async searchSavedKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchResultItem[]> {
    const embedding = await this.embeddingProvider.embed(query);
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;
    const result = await this.db.execute(
      sql`
      SELECT
        id,
        url,
        title,
        summary,
        1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) AS score
      FROM articles
      WHERE ${minScore} <= 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector)
      ORDER BY embedding <=> ${toVectorLiteral(embedding)}::vector
      LIMIT ${limit}
      `,
    );

    return (result.rows as unknown as SearchRow[]).map((row) => ({
      articleId: row.id,
      score: row.score,
      title: row.title,
      summary: row.summary,
      url: row.url,
    }));
  }
}

const toVectorLiteral = (values: number[]): string => `[${values.join(",")}]`;

const mapSavedArticle = (
  row: typeof articlesTable.$inferSelect | undefined,
): SavedArticle | null => {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    summary: row.summary,
    rawMarkdown: row.rawMarkdown,
    createdAt: new Date(row.createdAt),
  };
};
