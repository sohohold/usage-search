// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultNormalizer, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultCard from '@/components/ResultCard';
import type { SearchResult } from '@/types';

const RESULT: SearchResult = {
  title: 'こころ',
  author: '夏目　漱石',
  card_url: 'https://example.com/cards/card773.html',
  snippet: 'その夜は<mark>月が綺麗</mark>で',
  context: 'その夜は<mark>月が綺麗</mark>で、私は縁側に腰を下ろしていた。',
};

function setup(overrides: Partial<SearchResult> = {}) {
  render(<ResultCard result={{ ...RESULT, ...overrides }} />);
  return {
    user: userEvent.setup(),
    card: screen.getByRole('article'),
    toggle: screen.getByRole('button'),
  };
}

/** Make window.getSelection report an active text selection. */
function withSelection(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text,
  } as unknown as Selection);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResultCard', () => {
  it('UI-20: 作品名と著者名を表示する', () => {
    setup();
    expect(screen.getByRole('link', { name: 'こころ' })).toBeInTheDocument();
    // 著者名の区切りは全角スペースなので、既定の空白正規化を止めて突き合わせる。
    expect(
      screen.getByText(RESULT.author, {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      })
    ).toBeInTheDocument();
  });

  it('UI-21: 図書カードへのリンクを新しいタブで安全に開く', () => {
    setup();
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href', RESULT.card_url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('UI-22: 初期表示では snippet を出し、context は出さない', () => {
    setup();
    expect(screen.getByText(/その夜は/)).toHaveTextContent('その夜は月が綺麗で');
    expect(screen.queryByText(/縁側に腰を下ろしていた/)).not.toBeInTheDocument();
  });

  it('UI-23: <mark> を文字列ではなく要素として描画する', () => {
    setup();
    const mark = document.body.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent('月が綺麗');
  });

  it('UI-24: カードのクリックで context に展開する', async () => {
    const { user, card } = setup();
    await user.click(card);
    expect(screen.getByText(/縁側に腰を下ろしていた/)).toBeInTheDocument();
  });

  it('UI-25: 再クリックで snippet に戻る', async () => {
    const { user, card } = setup();
    await user.click(card);
    await user.click(card);
    expect(screen.queryByText(/縁側に腰を下ろしていた/)).not.toBeInTheDocument();
  });

  it('UI-26: リンクのクリックでは展開しない', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'こころ' }));
    expect(screen.queryByText(/縁側に腰を下ろしていた/)).not.toBeInTheDocument();
  });

  it('UI-27: テキスト選択中のクリックでは展開しない', async () => {
    const { user, card } = setup();
    withSelection('月が綺麗');
    await user.click(card);
    expect(screen.queryByText(/縁側に腰を下ろしていた/)).not.toBeInTheDocument();
  });

  it('UI-28: 展開ボタンが aria-expanded とラベルを状態に合わせる', async () => {
    const { user, toggle } = setup();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('＋ 前後の文脈を表示');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('− 文脈を閉じる');
  });

  it('UI-29: 展開ボタンのクリックが親カードと二重に発火しない', async () => {
    const { user, toggle } = setup();
    await user.click(toggle);
    // 二重発火なら展開→即収納で snippet のままになる。
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/縁側に腰を下ろしていた/)).toBeInTheDocument();
  });

  it('UI-30: context が空なら展開しても snippet を表示する', async () => {
    const { user, card, toggle } = setup({ context: '' });
    await user.click(card);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/その夜は/)).toHaveTextContent('その夜は月が綺麗で');
  });
});
