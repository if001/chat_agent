import { createCustomTools } from "./customTools";
import { SimpleWebClient } from "../web/simpleWebClient";
import {
  KnowledgeRepository,
  SavedArticle,
  SearchResultItem,
  UserMemoryStore,
} from "../../core/types";

class InMemoryKnowledgeRepo implements KnowledgeRepository {
  private readonly articles = new Map<string, SavedArticle>();
  private nextId = 1;

  async saveArticle(
    article: Omit<SavedArticle, "id" | "createdAt">,
  ): Promise<SavedArticle> {
    const saved: SavedArticle = {
      ...article,
      id: `it-${this.nextId++}`,
      createdAt: new Date(),
    };
    this.articles.set(saved.id, saved);
    return saved;
  }

  async getSavedArticleById(articleId: string): Promise<SavedArticle | null> {
    return this.articles.get(articleId) ?? null;
  }

  async getSavedArticleByUrl(url: string): Promise<SavedArticle | null> {
    for (const article of this.articles.values()) {
      if (article.url === url) {
        return article;
      }
    }
    return null;
  }

  async searchSavedKnowledge(query: string): Promise<SearchResultItem[]> {
    const items = [...this.articles.values()]
      .filter(
        (article) =>
          article.title.includes(query) || article.summary.includes(query),
      )
      .map((article) => ({
        articleId: article.id,
        score: 0.5,
        title: article.title,
        summary: article.summary,
        url: article.url,
      }));
    return items;
  }
}

class InMemoryUserMemoryStore implements UserMemoryStore {
  async rememberUserNote(): Promise<void> {
    return;
  }

  async listUserNotes(): Promise<Array<{ note: string; createdAt: Date }>> {
    return [];
  }

  async readMemoryFile(path: string): Promise<string> {
    return `file:${path}`;
  }
}

const runIntegration = process.env.RUN_WEB_BACKEND_TESTS === "1";
const integrationTest = runIntegration ? test : test.skip;

integrationTest(
  "custom tools work against real web backend",
  async () => {
    const baseUrl = process.env.SIMPLE_CLIENT_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        "SIMPLE_CLIENT_BASE_URL is required when RUN_WEB_BACKEND_TESTS=1",
      );
    }

    const repository = new InMemoryKnowledgeRepo();
    const tools = createCustomTools({
      knowledgeRepository: repository,
      webClient: new SimpleWebClient(baseUrl),
      userMemoryStore: new InMemoryUserMemoryStore(),
      defaultUserId: "u1",
      botId: "b1",
    });

    const webListTool = tools.find((tool) => tool.name === "web_list");
    const webPageTool = tools.find((tool) => tool.name === "web_page");
    const saveWebKnowledgeTool = tools.find(
      (tool) => tool.name === "save_web_knowledge",
    );
    if (!webListTool || !webPageTool || !saveWebKnowledgeTool) {
      throw new Error("required tools are missing");
    }

    const listResult = await webListTool.invoke({ query: "langchain", k: 3 });
    const listParsed = JSON.parse(listResult as string) as {
      results: unknown[];
    };
    expect(Array.isArray(listParsed.results)).toBe(true);

    const pageUrl = "https://www.if-blog.site/posts/paper/paper25/";
    const pageResult = await webPageTool.invoke({ url: pageUrl });
    const pageParsed = JSON.parse(pageResult as string) as {
      url: string;
      title: string;
      markdown: string;
    };
    expect(pageParsed.url.length).toBeGreaterThan(0);
    expect(pageParsed.title.length).toBeGreaterThan(0);
    expect(pageParsed.markdown.length).toBeGreaterThan(0);

    const saveResult = await saveWebKnowledgeTool.invoke({ url: pageUrl });
    const saveParsed = JSON.parse(saveResult as string) as {
      articleId: string;
      summary: string;
    };
    expect(saveParsed.articleId.length).toBeGreaterThan(0);
    expect(saveParsed.summary.length).toBeGreaterThan(0);

    const saved = await repository.getSavedArticleById(saveParsed.articleId);
    expect(saved).not.toBeNull();
  },
  30000,
);
