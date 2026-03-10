export interface SearchResult {
  title: string;
  author: string;
  card_url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  over_limit: boolean;
  results: SearchResult[];
}

export interface Stats {
  works: number;
  chunks: number;
}
