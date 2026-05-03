import { AgentRuntime, BotIdentity, KnowledgeRepository, WebClient } from "../types";
import { analyzeArticle } from "./analyzeArticle";

export const ingestSharedKnowledge = async (
  identity: BotIdentity,
  runtime: AgentRuntime,
  repository: KnowledgeRepository,
  webClient: WebClient,
  url: string,
  threadId?: string,
): Promise<{ title: string; summary: string; articleId: string }> => {
  const page = await webClient.webPage(url);
  const analysis = await analyzeArticle(
    runtime,
    identity.botId,
    page.title,
    page.url,
    page.markdown,
    threadId,
  );

  const saved = await repository.saveArticle({
    title: page.title,
    url: page.url,
    summary: analysis.summary,
    content: analysis.content,
    tags: analysis.tags,
    rawMarkdown: page.markdown,
  });

  return {
    articleId: saved.id,
    title: saved.title,
    summary: saved.summary,
  };
};
