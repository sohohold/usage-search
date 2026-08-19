/**
 * テスト仕様書 §9「短いクエリ（1〜2文字）」に対応するテスト。
 *
 * 現行の索引は FTS5 trigram なので、この節の要件はまだ満たせません（3文字未満では
 * トークンが生成されず、必ず0件になります）。方式の比較と移行計画は
 * docs/short-query-search.md にあり、実装（移行計画の段階2）でこのファイルの
 * `it.skip` を外します。仕様が先にあり、実装が後から追いつく順序です。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, CHUNKS, SHORT_QUERY_CHUNKS } from './helpers/db';
import { search } from '@/lib/db';

let cleanup: () => void;

beforeAll(async () => {
  const db = await createTestDb();
  cleanup = db.cleanup;
  process.env.TURSO_DATABASE_URL = db.url;
});

afterAll(() => cleanup());

/** コーパス上で実際に部分文字列を含むチャンク数。SQ-04 の正解値に使う。 */
function countIn(corpus: string[], q: string): number {
  return corpus.filter((t) => t.includes(q)).length;
}

const corpus = CHUNKS.map((c) => c.text);

describe('短いクエリ（1〜2文字）', () => {
  it.skip('SQ-01: 1文字で検索できる', async () => {
    const res = await search('月', 50, 0);
    expect(res.results.length).toBe(countIn(corpus, '月'));
  });

  it.skip('SQ-02: 2文字で検索できる', async () => {
    const res = await search('月が', 50, 0);
    expect(res.results.length).toBe(countIn(corpus, '月が'));
  });

  it.skip('SQ-03: チャンク末尾の1文字を取りこぼさない', async () => {
    // SHORT_QUERY_CHUNKS.tailChar は「月」で終わる本文。n-gram の作り方によっては
    // 後続の文字がないこの位置だけ索引から漏れる。
    expect(SHORT_QUERY_CHUNKS.tailChar.endsWith('月')).toBe(true);
    const res = await search('月', 50, 0);
    expect(res.results.some((r) => r.snippet.endsWith('<mark>月</mark>'))).toBe(true);
  });

  it.skip('SQ-04: 1〜4文字で LIKE と同じ件数を返す', async () => {
    const samples: string[] = [];
    for (const text of corpus) {
      const chars = Array.from(text);
      for (const len of [1, 2, 3, 4]) {
        if (chars.length < len) continue;
        const i = Math.floor((chars.length - len) / 2);
        samples.push(chars.slice(i, i + len).join(''));
      }
    }
    for (const q of samples) {
      const res = await search(q, 100, 0);
      expect(res.results.length, `クエリ ${JSON.stringify(q)}`).toBe(countIn(corpus, q));
    }
  });

  it.skip('SQ-05: 約物・記号1文字で検索できる', async () => {
    for (const q of ['。', '」']) {
      const res = await search(q, 100, 0);
      expect(res.results.length, `クエリ ${q}`).toBe(countIn(corpus, q));
    }
  });

  it.skip('SQ-06: 英字1文字は大小を同一視する', async () => {
    const upper = await search('A', 50, 0);
    const lower = await search('a', 50, 0);
    expect(upper.results.length).toBeGreaterThan(0);
    expect(lower.results.map((r) => r.snippet)).toEqual(upper.results.map((r) => r.snippet));
  });

  it.skip('SQ-07: サロゲートペアを1文字として扱う', async () => {
    const res = await search('𠮟', 50, 0);
    expect(res.results.length).toBe(countIn(corpus, '𠮟'));
    // 上位・下位サロゲートを単体で投げても、壊れた検索にならない（0件で返る）
    expect((await search('\ud842', 50, 0)).results).toEqual([]);
  });

  it.skip('SQ-08: 1文字クエリでも一致した1文字だけをハイライトする', async () => {
    const res = await search('月', 50, 0);
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.snippet).toContain('<mark>月</mark>');
    }
  });

  it.skip('SQ-09: 1文字クエリのページングが安定している', async () => {
    const all = await search('の', 50, 0);
    expect(all.results.length).toBeGreaterThan(6);

    const first = await search('の', 3, 0);
    const second = await search('の', 3, 3);
    expect(first.results.map((r) => r.snippet)).toEqual(all.results.slice(0, 3).map((r) => r.snippet));
    expect(second.results.map((r) => r.snippet)).toEqual(all.results.slice(3, 6).map((r) => r.snippet));

    // 同じ入力なら順序が変わらない
    const again = await search('の', 50, 0);
    expect(again.results.map((r) => r.snippet)).toEqual(all.results.map((r) => r.snippet));
  });

  it.skip('SQ-11: 高頻度クエリでも rank を使わず挿入順で返す', async () => {
    // rowid 昇順 = コーパスの投入順。bm25 で並べ替えるとこの順序は崩れる。
    const res = await search('の', 50, 0);
    const matched = corpus.filter((t) => t.includes('の'));
    const got = res.results.map((r) => r.snippet.replace(/<\/?mark>|…/g, ''));
    expect(got.length).toBe(matched.length);
    for (let i = 0; i < got.length; i++) {
      expect(matched[i]).toContain(got[i]);
    }
  });

  it.skip('SQ-12: 1文字の FTS5 演算子をリテラルとして扱う', async () => {
    // 演算子として解釈されると全件ヒットや構文エラーになる。
    for (const q of ['*', '"', '(', '^']) {
      const res = await search(q, 50, 0);
      expect(res.results.length, `クエリ ${q}`).toBe(countIn(corpus, q));
    }
    expect((await search('OR', 50, 0)).results.length).toBe(countIn(corpus, 'OR'));
  });
});
