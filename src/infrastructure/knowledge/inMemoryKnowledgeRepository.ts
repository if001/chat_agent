import { KnowledgeRepository, SavedArticle, SearchKnowledgeOptions, SearchResultItem } from "../../core/types";

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly byId = new Map<string, SavedArticle>();
  private readonly byUrl = new Map<string, SavedArticle>();

  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    const existing = this.byUrl.get(article.url);
    if (existing) {
      const updated: SavedArticle = {
        ...existing,
        title: article.title,
        summary: article.summary,
        content: article.content,
        tags: article.tags,
        rawMarkdown: article.rawMarkdown,
      };
      this.byId.set(existing.id, updated);
      this.byUrl.set(existing.url, updated);
      return updated;
    }

    const saved: SavedArticle = {
      ...article,
      id: `article_${this.byId.size + 1}`,
      createdAt: new Date(),
    };
    this.byId.set(saved.id, saved);
    this.byUrl.set(saved.url, saved);
    return saved;
  }

  async getSavedArticleById(articleId: string): Promise<SavedArticle | null> {
    return this.byId.get(articleId) ?? null;
  }

  async getSavedArticleByUrl(url: string): Promise<SavedArticle | null> {
    return this.byUrl.get(url) ?? null;
  }

  async searchSavedKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchResultItem[]> {
    const lowered = query.toLowerCase();
    const items = Array.from(this.byId.values()).filter((v) => {
      const haystack = `${v.title}\n${v.summary}\n${v.content}\n${v.tags.join(" ")}`.toLowerCase();
      return haystack.includes(lowered);
    });

    const mapped = items.map((v, index) => ({
      articleId: v.id,
      score: 1 / (index + 1),
      title: v.title,
      summary: v.summary,
      tags: v.tags,
      url: v.url,
    }));
    const minScore = options?.minScore ?? 0;
    const filtered = mapped.filter((item) => item.score >= minScore);
    const limit = options?.limit ?? 10;
    return filtered.slice(0, limit);
  }
}
