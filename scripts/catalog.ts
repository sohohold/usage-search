/**
 * Pure helpers for the Aozora Bunko indexer.
 *
 * Kept separate from build-index.ts so they can be imported without running the
 * indexer: build-index.ts executes main() on import.
 */

import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

export interface CatalogRow {
  work_id: string;
  title: string;
  author: string;
  card_url: string;
  file_url: string;
  encoding: string;
}

/**
 * Convert an aozora.gr.jp zip URL to a raw GitHub URL for aozorabunko_text.
 * e.g. https://www.aozora.gr.jp/cards/000081/files/45630_ruby_23610.zip
 *   -> https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/000081/files/45630_ruby_23610/45630_ruby_23610.txt
 * Returns null if the URL doesn't match the expected zip pattern.
 */
export function textUrlFromFileUrl(fileUrl: string): string | null {
  const match = fileUrl.match(/\/(cards\/\d+\/files\/([^/]+))\.zip$/);
  if (!match) return null;
  const [, dirPath, basename] = match;
  return `https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/${dirPath}/${basename}.txt`;
}

/** Parse the catalog CSV, keeping only public-domain works that have a text file. */
export function parseCatalog(csvBuffer: Buffer): CatalogRow[] {
  const records = parse(csvBuffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  }) as Record<string, string>[];

  return records
    .filter(
      (r) =>
        r['作品著作権フラグ'] === 'なし' &&
        r['人物著作権フラグ'] === 'なし' &&
        r['テキストファイルURL']?.trim()
    )
    .map((r) => ({
      work_id: r['作品ID'],
      title: r['作品名'],
      // Surname and given name are separate columns; either may be empty.
      author: `${r['姓']}　${r['名']}`.trim(),
      card_url: r['図書カードURL'],
      file_url: r['テキストファイルURL'],
      encoding: r['テキストファイル符号化方式']?.trim() || 'ShiftJIS',
    }));
}

/** Decode a downloaded text file using the encoding named in the catalog. */
export function decodeText(buf: Buffer, encoding: string): string {
  const enc = encoding.toLowerCase().includes('utf') ? 'utf8' : 'Shift_JIS';
  return iconv.decode(buf, enc);
}

/** Map over items with bounded concurrency, preserving input order in the result. */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export const RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Retry an async operation, waiting `delays[attempt]` ms between attempts.
 * Gives up after `delays.length` retries and rethrows the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
