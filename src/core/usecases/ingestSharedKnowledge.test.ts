import { ingestSharedKnowledge } from "./ingestSharedKnowledge";
import { AgentRuntime, BotIdentity, KnowledgeRepository, SavedArticle, WebClient, WebPage } from "../types";

class RuntimeStub implements AgentRuntime {
  async respond(): Promise<{ content: string }> {
    return { content: "short summary" };
  }
}

class WebClientStub implements WebClient {
  async webList(): Promise<never[]> {
    return [];
  }

  async webPage(url: string): Promise<WebPage> {
    return {
      url,
      title: "Article Title",
      markdown: "Article content",
    };
  }
}

class RepoStub implements KnowledgeRepository {
  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    return {
      ...article,
      id: "a1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }

  async getSavedArticleById(): Promise<SavedArticle | null> {
    return null;
  }

  async getSavedArticleByUrl(): Promise<SavedArticle | null> {
    return null;
  }

  async searchSavedKnowledge(_query: string): Promise<never[]> {
    return [];
  }
}

const identity: BotIdentity = {
  botId: "bot-a",
  systemPrompt: "You are a summarizer",
};

test("fetches page, summarizes, and stores shared knowledge", async () => {
  const result = await ingestSharedKnowledge(
    identity,
    new RuntimeStub(),
    new RepoStub(),
    new WebClientStub(),
    "https://example.com/post",
  );

  expect(result).toEqual({
    articleId: "a1",
    title: "Article Title",
    summary: "short summary",
  });
});
