import { AgentRuntime } from "../types";

export interface ArticleAnalysis {
  summary: string;
  content: string;
  tags: string[];
}

export const analyzeArticle = async (
  runtime: AgentRuntime,
  botId: string,
  title: string,
  url: string,
  markdown: string,
  threadId?: string,
): Promise<ArticleAnalysis> => {
  const response = await runtime.respond({
    botId,
    systemPrompt: ARTICLE_ANALYZER_PROMPT,
    ...(threadId ? { threadId } : {}),
    messages: [
      {
        role: "user",
        content: [
          "以下の記事を解析してください。",
          "JSONのみを返してください。",
          '形式: {"summary":"...", "content":"...", "tags":["tag1","tag2"]}',
          "summaryは3-5文、contentは記事内容の要点説明、tagsは3-8個の短いタグにしてください。",
          `タイトル: ${title}`,
          `URL: ${url}`,
          "本文:",
          markdown,
        ].join("\n"),
      },
    ],
  });

  return parseArticleAnalysis(response.content);
};

const ARTICLE_ANALYZER_PROMPT = [
  "You analyze web articles and return structured metadata.",
  "Return JSON only.",
  "Use concise Japanese for summary and content.",
  "tags must be a JSON array of short strings.",
].join(" ");

const parseArticleAnalysis = (content: string): ArticleAnalysis => {
  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== "object") {
    return { summary: content, content, tags: [] };
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : content.trim();
  const articleContent =
    typeof parsed.content === "string" ? parsed.content.trim() : summary;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

  return {
    summary,
    content: articleContent,
    tags: dedupeTags(tags),
  };
};

const tryParseJson = (input: string): Record<string, unknown> | null => {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const dedupeTags = (tags: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(tag);
  }
  return result;
};
