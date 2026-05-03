import { ingestSharedKnowledge } from "./ingestSharedKnowledge";
import { AgentRuntime, BotIdentity, KnowledgeRepository, SavedArticle, WebClient, WebPage } from "../types";

class RuntimeStub implements AgentRuntime {
  async respond(): Promise<{ content: string }> {
    return {
      content: JSON.stringify({
        summary: "short summary",
        content: "article content digest",
        tags: ["langchain", "agents"],
      }),
    };
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
  public savedInput: Omit<SavedArticle, "id" | "createdAt"> | null = null;

  async saveArticle(article: Omit<SavedArticle, "id" | "createdAt">): Promise<SavedArticle> {
    this.savedInput = article;
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
  const repository = new RepoStub();
  const result = await ingestSharedKnowledge(
    identity,
    new RuntimeStub(),
    repository,
    new WebClientStub(),
    "https://example.com/post",
  );

  expect(result).toEqual({
    articleId: "a1",
    title: "Article Title",
    summary: "short summary",
  });
  expect(repository.savedInput?.content).toBe("article content digest");
  expect(repository.savedInput?.tags).toEqual(["langchain", "agents"]);
});
