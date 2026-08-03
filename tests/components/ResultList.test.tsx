// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultList from '@/components/ResultList';
import type { SearchResponse, SearchResult } from '@/types';

function result(i: number): SearchResult {
  return {
    title: `作品${i}`,
    author: '夏目　漱石',
    card_url: `https://example.com/cards/card${i}.html`,
    snippet: `第${i}の<mark>用例</mark>`,
    context: `第${i}の<mark>用例</mark>の前後の文脈`,
  };
}

function setup(data: Partial<SearchResponse> = {}, isLoadingMore = false) {
  const onLoadMore = vi.fn();
  const full: SearchResponse = {
    query: '用例',
    over_limit: false,
    results: [result(1), result(2), result(3)],
    ...data,
  };
  render(<ResultList data={full} onLoadMore={onLoadMore} isLoadingMore={isLoadingMore} />);
  return { onLoadMore, user: userEvent.setup() };
}

const loadMoreButton = () => screen.queryByRole('button', { name: /もっと見る|読み込み中/ });

describe('ResultList', () => {
  it('UI-10: over_limit=false のときは確定件数を表示する', () => {
    setup();
    expect(screen.getByText('3件')).toBeInTheDocument();
  });

  it('UI-11: over_limit=true のときは「N件以上」と表示する', () => {
    setup({ over_limit: true });
    expect(screen.getByText('3件以上')).toBeInTheDocument();
  });

  it('UI-12: 検索クエリを見出しに表示する', () => {
    setup({ query: '月が綺麗' });
    expect(screen.getByText('「月が綺麗」')).toBeInTheDocument();
  });

  it('UI-13: 結果の件数だけカードを描画する', () => {
    setup({ results: [result(1), result(2), result(3), result(4), result(5)] });
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('UI-14: over_limit=true なら「もっと見る」を出す', () => {
    setup({ over_limit: true });
    expect(loadMoreButton()).toBeInTheDocument();
  });

  it('UI-15: over_limit=false なら「もっと見る」を出さない', () => {
    setup({ over_limit: false });
    expect(loadMoreButton()).not.toBeInTheDocument();
  });

  it('UI-16: 「もっと見る」のクリックで onLoadMore を1回呼ぶ', async () => {
    const { user, onLoadMore } = setup({ over_limit: true });
    await user.click(loadMoreButton()!);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('UI-17: 追加読み込み中はボタンを押せず、ラベルが変わる', () => {
    setup({ over_limit: true }, true);
    const button = loadMoreButton()!;
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('読み込み中…');
  });

  it('UI-18: 結果が0件なら「用例が見つかりませんでした」を出す', () => {
    setup({ results: [] });
    expect(screen.getByText('用例が見つかりませんでした')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
