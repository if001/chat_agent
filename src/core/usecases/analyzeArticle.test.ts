import { analyzeArticle } from "./analyzeArticle";
import { AgentRuntime, AgentResponse, AgentRequest } from "../types";

class RuntimeStub implements AgentRuntime {
  constructor(private readonly response: string) {}

  async respond(_request: AgentRequest): Promise<AgentResponse> {
    return { content: this.response };
  }
}

test("parses structured article analysis json", async () => {
  const result = await analyzeArticle(
    new RuntimeStub(
      JSON.stringify({
        summary: "short summary",
        content: "detailed content",
        tags: ["ai", "agents", "AI"],
      }),
    ),
    "bot-a",
    "Title",
    "https://example.com",
    "markdown",
  );

  expect(result.summary).toBe("short summary");
  expect(result.content).toBe("detailed content");
  expect(result.tags).toEqual(["ai", "agents"]);
});

test("falls back when analysis is not json", async () => {
  const result = await analyzeArticle(
    new RuntimeStub("plain summary text"),
    "bot-a",
    "Title",
    "https://example.com",
    "markdown",
  );

  expect(result.summary).toBe("plain summary text");
  expect(result.content).toBe("plain summary text");
  expect(result.tags).toEqual([]);
});
