// The FTS index uses trigram tokenization, so queries under 3 characters can never match.
export const MIN_QUERY_LENGTH = 3;
export const PAGE_SIZE = 20;

export interface SearchResult {
  title: string;
  author: string;
  card_url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  over_limit: boolean;
  results: SearchResult[];
}

export interface Stats {
  works: number;
  chunks: number;
}
