import { ChatOllama } from "@langchain/ollama";

export const createOllamaChatModel = (
  baseUrl: string,
  model: string,
): ChatOllama => {
  return new ChatOllama({
    baseUrl,
    model,
    temperature: 0.2,
  });
};

export const createOllamaChatModelCloud = (
  baseUrl: string,
  model: string,
  apiKey: string,
): ChatOllama => {
  return new ChatOllama({
    baseUrl,
    model,
    temperature: 0.2,
    headers: new Headers({
      Authorization: `Bearer ${apiKey}`,
    }),
  });
};
