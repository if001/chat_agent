import { KnowledgeRepository, SavedArticle, SearchKnowledgeOptions, SearchResultItem } from "../../core/types";

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface Queryable {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

interface SavedArticleRow extends QueryResultRow {
  id: string;
  url: string;
  title: string;
  summary: string;
  raw_markdown: string;
  created_at: Date;
}

interface SearchRow extends QueryResultRow {
  id: string;
  url: string;
  title: string;
  summary: string;
  score: number;
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly embeddingDimension: number,
  ) {}

  async initialize(): Promise<void> {
    await this.db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        raw_markdown TEXT NOT NULL,
        embedding vector(${this.embeddingDimension}),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.query(
      "CREATE INDEX IF NOT EXISTS articles_embedding_idx ON articles USING ivfflat (embedding vector_cosine_ops)",
    );
  }

  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    const embedding = await this.embeddingProvider.embed(`${article.title}\n${article.summary}\n${article.rawMarkdown}`);
    const id = `article_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const result = await this.db.query<SavedArticleRow>(
      `
      INSERT INTO articles (id, url, title, summary, raw_markdown, embedding)
      VALUES ($1, $2, $3, $4, $5, $6::vector)
      ON CONFLICT (url) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        raw_markdown = EXCLUDED.raw_markdown,
        embedding = EXCLUDED.embedding
      RETURNING id, url, title, summary, raw_markdown, created_at
      `,
      [id, article.url, article.title, article.summary, article.rawMarkdown, toVectorLiteral(embedding)],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to save article");
    }

    return mapSavedArticleRow(row);
  }

  async getSavedArticleById(articleId: string): Promise<SavedArticle | null> {
    const result = await this.db.query<SavedArticleRow>(
      "SELECT id, url, title, summary, raw_markdown, created_at FROM articles WHERE id = $1",
      [articleId],
    );
    return result.rows[0] ? mapSavedArticleRow(result.rows[0]) : null;
  }

  async getSavedArticleByUrl(url: string): Promise<SavedArticle | null> {
    const result = await this.db.query<SavedArticleRow>(
      "SELECT id, url, title, summary, raw_markdown, created_at FROM articles WHERE url = $1",
      [url],
    );
    return result.rows[0] ? mapSavedArticleRow(result.rows[0]) : null;
  }

  async searchSavedKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchResultItem[]> {
    const embedding = await this.embeddingProvider.embed(query);
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;
    const result = await this.db.query<SearchRow>(
      `
      SELECT
        id,
        url,
        title,
        summary,
        1 - (embedding <=> $1::vector) AS score
      FROM articles
      WHERE 1 - (embedding <=> $1::vector) >= $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
      `,
      [toVectorLiteral(embedding), minScore, limit],
    );

    return result.rows.map((row) => ({
      articleId: row.id,
      score: row.score,
      title: row.title,
      summary: row.summary,
      url: row.url,
    }));
  }
}

const toVectorLiteral = (values: number[]): string => `[${values.join(",")}]`;

const mapSavedArticleRow = (row: SavedArticleRow): SavedArticle => ({
  id: row.id,
  url: row.url,
  title: row.title,
  summary: row.summary,
  rawMarkdown: row.raw_markdown,
  createdAt: new Date(row.created_at),
});
