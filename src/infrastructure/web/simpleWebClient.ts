import { WebClient, WebListItem, WebPage } from "../../core/types";

interface ListResponse {
  query: string;
  k: number;
  results: Array<{
    rank: number;
    title: string;
    url: string;
    snippet?: string;
    published_date?: string;
  }>;
}

interface PageResponse {
  docs: Array<{
    url: string;
    title: string;
    markdown: string;
  }>;
}

export class SimpleWebClient implements WebClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async webList(query: string, k: number): Promise<WebListItem[]> {
    const response = await this.fetchFn(`${this.baseUrl}/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: query, k }),
    });
    if (!response.ok) {
      throw new Error(`webList failed: ${response.status}`);
    }

    const data = (await response.json()) as ListResponse;
    return data.results.map((result) => {
      const item: WebListItem = {
        rank: result.rank,
        title: result.title,
        url: result.url,
      };
      if (result.snippet !== undefined) {
        item.snippet = result.snippet;
      }
      if (result.published_date !== undefined) {
        item.publishedDate = result.published_date;
      }
      return item;
    });
  }

  async webPage(url: string): Promise<WebPage> {
    const response = await this.fetchFn(`${this.baseUrl}/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: url }),
    });
    if (!response.ok) {
      throw new Error(`webPage failed: ${response.status}`);
    }

    const data = (await response.json()) as PageResponse;
    if (data.docs.length === 0) {
      throw new Error(`webPage returned empty docs for url=${url}`);
    }

    const page = data.docs[0];
    if (!page) {
      throw new Error(`webPage returned empty docs for url=${url}`);
    }
    return {
      url: page.url,
      title: page.title,
      markdown: page.markdown,
    };
  }
}
