import { AgentRuntime, BotIdentity, KnowledgeRepository, WebClient } from "../types";

export const ingestSharedKnowledge = async (
  identity: BotIdentity,
  runtime: AgentRuntime,
  repository: KnowledgeRepository,
  webClient: WebClient,
  url: string,
  threadId?: string,
): Promise<{ title: string; summary: string; articleId: string }> => {
  const page = await webClient.webPage(url);
  const summaryResponse = await runtime.respond({
    botId: identity.botId,
    systemPrompt: identity.systemPrompt,
    ...(threadId ? { threadId } : {}),
    messages: [
      {
        role: "user",
        content: `次の記事を3-5文で要約してください。タイトル: ${page.title}\nURL: ${page.url}\n本文:\n${page.markdown}`,
      },
    ],
  });

  const saved = await repository.saveArticle({
    title: page.title,
    url: page.url,
    summary: summaryResponse.content,
    rawMarkdown: page.markdown,
  });

  return {
    articleId: saved.id,
    title: saved.title,
    summary: saved.summary,
  };
};
