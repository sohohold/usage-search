// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Home from '@/app/page';
import type { SearchResponse, SearchResult } from '@/types';

const DEBOUNCE_MS = 400;
const STATS = { works: 2, chunks: 17 };

interface PendingCall {
  url: string;
  signal: AbortSignal | null;
  resolve: (body: unknown, init?: { ok?: boolean; status?: number }) => void;
  reject: (err: unknown) => void;
}

let searchCalls: PendingCall[];
let statsResponds: (ok: boolean) => void;

/**
 * Replace global fetch: /api/stats settles on demand, and every /api/search
 * call is parked in `searchCalls` so tests can order responses deliberately.
 */
function stubFetch() {
  searchCalls = [];
  let statsSettle: (ok: boolean) => void = () => {};

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/stats')) {
        return new Promise<Response>((resolve, reject) => {
          statsSettle = (ok: boolean) =>
            ok
              ? resolve({ ok: true, status: 200, json: async () => STATS } as Response)
              : reject(new TypeError('network'));
        });
      }

      const signal = init?.signal ?? null;
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
        searchCalls.push({
          url,
          signal,
          resolve: (body, { ok = true, status = 200 } = {}) =>
            resolve({ ok, status, json: async () => body } as Response),
          reject,
        });
      });
    })
  );

  statsResponds = (ok: boolean) => statsSettle(ok);
}

function results(query: string, count: number, from = 0): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `作品${from + i}`,
    author: '夏目　漱石',
    card_url: `https://example.com/cards/card${from + i}.html`,
    snippet: `${query}の用例その${from + i}`,
    context: `${query}の用例その${from + i}の広い文脈`,
  }));
}

function response(query: string, count: number, over_limit = false, from = 0): SearchResponse {
  return { query, over_limit, results: results(query, count, from) };
}

/** Let queued promise callbacks and their React updates run to completion. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle();
}

const input = () => screen.getByRole('textbox');
const loadMore = () => screen.queryByRole('button', { name: /もっと見る|読み込み中/ });

/** Set the whole query box value. fireEvent keeps typing independent of the fake clock. */
const type = (value: string) => fireEvent.change(input(), { target: { value } });

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Render, resolve the stats request, and run a completed search for `query`. */
async function renderWithResults(query: string, count: number, over_limit = false) {
  render(<Home />);
  statsResponds(true);
  await settle();

  type(query);
  await advance(DEBOUNCE_MS);
  searchCalls.at(-1)!.resolve(response(query, count, over_limit));
  await settle();
}

describe('統計情報', () => {
  it('PG-01: マウント時に統計を1回だけ取得して表示する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith('/api/stats'))).toHaveLength(1);
    expect(document.body.textContent).toContain('2 作品');
    expect(document.body.textContent).toContain('17 段落');
  });

  it('PG-02: 統計の取得に失敗しても画面が壊れない', async () => {
    render(<Home />);
    statsResponds(false);
    await settle();

    expect(screen.getByText('青空文庫全文用例検索')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('作品 /');
  });
});

describe('検索の発火', () => {
  it('PG-03: 3文字未満では自動検索しない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が');
    await advance(DEBOUNCE_MS * 2);
    expect(searchCalls).toHaveLength(0);
  });

  it('PG-04: 3文字未満でも明示送信なら検索し、サーバーのメッセージを表示する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が');
    await advance(DEBOUNCE_MS * 2);
    expect(searchCalls).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].url).toContain(`q=${encodeURIComponent('月が')}`);

    searchCalls[0].resolve({ error: '3文字以上入力してください' }, { ok: false, status: 400 });
    await settle();
    expect(screen.getByText('3文字以上入力してください')).toBeInTheDocument();
  });

  it('PG-05: Enter でも3文字未満のクエリを送信する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].url).toContain(`q=${encodeURIComponent('月が')}`);
  });

  it('PG-06: 空・空白のみのクエリは送信しない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('   ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await advance(DEBOUNCE_MS * 2);

    expect(searchCalls).toHaveLength(0);
  });

  it('PG-07: 3文字以上なら400ms後に1回だけ検索する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS - 1);
    expect(searchCalls).toHaveLength(0);

    await advance(1);
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].url).toContain(`q=${encodeURIComponent('月が綺麗')}`);
  });

  it('PG-08: 連続入力では最後のクエリで1回だけ検索する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺');
    await advance(300);
    type('月が綺麗');
    await advance(300);
    expect(searchCalls).toHaveLength(0);

    await advance(100);
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].url).toContain(`q=${encodeURIComponent('月が綺麗')}`);
  });

  it('PG-09: 検索ボタンはデバウンスを待たずに検索し、二重に呼ばない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(searchCalls).toHaveLength(1);

    await advance(DEBOUNCE_MS * 2);
    expect(searchCalls).toHaveLength(1);
  });
});

describe('リクエストの競合', () => {
  it('PG-10: 検索中に新しいクエリが来たら先行リクエストを中断する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    const first = searchCalls[0];
    expect(first.signal!.aborted).toBe(false);

    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);

    expect(first.signal!.aborted).toBe(true);
    expect(searchCalls).toHaveLength(2);
  });

  it('PG-11: 中断された先行レスポンスで新しい結果が上書きされない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    const first = searchCalls[0];

    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);
    const second = searchCalls[1];

    second.resolve(response('月が綺麗な夜', 2));
    await settle();
    // 中断済みの先行リクエストが後から解決しても表示は変わらない。
    first.resolve(response('月が綺麗', 5));
    await settle();

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(document.body.textContent).toContain('「月が綺麗な夜」');
  });

  it('PG-12: 中断をエラーとして表示しない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);

    expect(screen.queryByText('サーバーに接続できませんでした')).not.toBeInTheDocument();
  });

  it('PG-13: 3文字未満に戻すと結果を消し、進行中のリクエストを中断する', async () => {
    await renderWithResults('月が綺麗', 3);
    expect(screen.getAllByRole('article')).toHaveLength(3);

    type('月');
    await advance(DEBOUNCE_MS);

    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('青空文庫全文用例検索')).toBeInTheDocument();
  });
});

describe('エラー表示', () => {
  it('PG-14: 400 応答はサーバーのメッセージを表示する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    searchCalls[0].resolve({ error: '3文字以上入力してください' }, { ok: false, status: 400 });
    await settle();

    expect(screen.getByText('3文字以上入力してください')).toBeInTheDocument();
  });

  it('PG-15: 通信エラーは接続失敗のメッセージを表示する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    searchCalls[0].reject(new TypeError('Failed to fetch'));
    await settle();

    expect(screen.getByText('サーバーに接続できませんでした')).toBeInTheDocument();
  });

  it('PG-16: 再検索が成功するとエラー表示が消える', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    await advance(DEBOUNCE_MS);
    searchCalls[0].reject(new TypeError('Failed to fetch'));
    await settle();
    expect(screen.getByText('サーバーに接続できませんでした')).toBeInTheDocument();

    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);
    searchCalls[1].resolve(response('月が綺麗な夜', 1));
    await settle();

    expect(screen.queryByText('サーバーに接続できませんでした')).not.toBeInTheDocument();
  });
});

describe('もっと見る', () => {
  it('PG-17: 既存件数を offset にして追加取得し、結果に追記する', async () => {
    await renderWithResults('月が綺麗', 20, true);

    fireEvent.click(loadMore()!);
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[1].url).toContain('offset=20');

    searchCalls[1].resolve(response('月が綺麗', 5, false, 20));
    await settle();

    expect(screen.getAllByRole('article')).toHaveLength(25);
  });

  it('PG-18: 入力欄の現在値ではなく表示中の結果のクエリで追加取得する', async () => {
    await renderWithResults('月が綺麗', 20, true);

    // デバウンスを進めないので、入力だけ変わって検索は走っていない状態。
    type('月が綺麗な夜');
    fireEvent.click(loadMore()!);

    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[1].url).toContain(`q=${encodeURIComponent('月が綺麗')}`);
    expect(searchCalls[1].url).not.toContain(encodeURIComponent('月が綺麗な夜'));
  });

  it('PG-19: 新しい検索の実行中は追加取得しない', async () => {
    await renderWithResults('月が綺麗', 20, true);

    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);
    expect(searchCalls).toHaveLength(2);

    expect(loadMore()).toBeDisabled();
    fireEvent.click(loadMore()!);
    expect(searchCalls).toHaveLength(2);
  });

  it('PG-20: 結果が無いうちは「もっと見る」を出さない', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    expect(loadMore()).not.toBeInTheDocument();
  });
});

describe('表示状態', () => {
  const spinner = () => document.body.querySelector('.animate-spin');

  it('PG-21: 検索中はスピナーを出し、既存結果を半透明にする', async () => {
    await renderWithResults('月が綺麗', 3);

    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);

    expect(spinner()).not.toBeNull();
    expect(document.body.querySelector('.opacity-50')).not.toBeNull();

    searchCalls[1].resolve(response('月が綺麗な夜', 1));
    await settle();

    expect(spinner()).toBeNull();
    expect(document.body.querySelector('.opacity-50')).toBeNull();
  });

  it('PG-22: 中断された先行リクエストの後始末でスピナーを消さない', async () => {
    await renderWithResults('月が綺麗', 3);

    // 先行リクエストを未解決のまま新しい検索で追い越す。
    type('月が綺麗な夜');
    await advance(DEBOUNCE_MS);
    expect(searchCalls).toHaveLength(2);

    type('月が綺麗な夜に');
    await advance(DEBOUNCE_MS);
    expect(searchCalls).toHaveLength(3);
    expect(searchCalls[1].signal!.aborted).toBe(true);

    // 中断された2番目の後始末が、実行中の3番目のスピナーを消してはいけない。
    expect(spinner()).not.toBeNull();

    searchCalls[2].resolve(response('月が綺麗な夜に', 1));
    await settle();
    expect(spinner()).toBeNull();
  });

  it('PG-23: 未検索ならプレースホルダを表示する', async () => {
    render(<Home />);
    statsResponds(true);
    await settle();

    expect(screen.getByText('青空文庫全文用例検索')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('PG-24: デバウンス待ちのままアンマウントしてもタイマーが残らない', async () => {
    const { unmount } = render(<Home />);
    statsResponds(true);
    await settle();

    type('月が綺麗');
    unmount();
    await advance(DEBOUNCE_MS * 2);

    expect(searchCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
