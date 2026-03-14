import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  _client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return _client;
}

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

const COUNT_LIMIT = 200;

export async function search(query: string, limit: number, offset: number): Promise<SearchResponse> {
  const client = getClient();
  const ftsQuery = `"${query.replace(/"/g, '""')}"`;

  // Fetch limit+1 rows so we can detect if more results exist without a separate COUNT query
  const resultsRes = await client.execute({
    sql: `SELECT w.title, w.author, w.card_url,
            snippet(chunks, 1, '<mark>', '</mark>', '…', 24) AS snippet
     FROM chunks
     JOIN works w ON chunks.work_id = CAST(w.id AS TEXT)
     WHERE chunks MATCH ?
     ORDER BY bm25(chunks)
     LIMIT ? OFFSET ?`,
    args: [ftsQuery, limit + 1, offset],
  });

  const hasMore = resultsRes.rows.length > limit;
  const rows = hasMore ? resultsRes.rows.slice(0, limit) : resultsRes.rows;

  const results = rows.map((row) => ({
    title: row.title as string,
    author: row.author as string,
    card_url: row.card_url as string,
    snippet: row.snippet as string,
  }));

  return {
    query,
    total: offset + results.length + (hasMore ? 1 : 0),
    over_limit: hasMore,
    results,
  };
}

export async function getStats(): Promise<Stats> {
  const client = getClient();

  const [worksRes, chunksRes] = await Promise.all([
    client.execute('SELECT count(*) AS works FROM works'),
    client.execute('SELECT count(*) AS chunks FROM chunks'),
  ]);

  return {
    works: worksRes.rows[0].works as number,
    chunks: chunksRes.rows[0].chunks as number,
  };
}
