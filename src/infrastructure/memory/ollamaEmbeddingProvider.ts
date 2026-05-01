import { EmbeddingProvider } from "../db/postgresKnowledgeRepository";

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await this.fetchFn(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`ollama embedding request failed: ${response.status}`);
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;
    return data.embedding;
  }
}
