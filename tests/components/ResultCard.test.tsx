// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, getDefaultNormalizer, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultCard from '@/components/ResultCard';
import type { SearchResult } from '@/types';

const RESULT: SearchResult = {
  title: 'こころ',
  author: '夏目　漱石',
  author_url: 'https://www.aozora.gr.jp/index_pages/person148.html',
  card_url: 'https://example.com/cards/card773.html',
  snippet: 'その夜は<mark>月が綺麗</mark>で',
  context: 'その夜は<mark>月が綺麗</mark>で、私は縁側に腰を下ろしていた。',
};

function setup(overrides: Partial<SearchResult> = {}) {
  render(<ResultCard result={{ ...RESULT, ...overrides }} />);
  return {
    user: userEvent.setup(),
    card: screen.getByRole('article'),
  };
}

/** 展開ボタン。前後の文脈がないカードには存在しない。 */
const toggle = () => screen.getByRole('button');

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
    for (const name of ['こころ', '図書カード →']) {
      const link = screen.getByRole('link', { name });
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
    const { user } = setup();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent('＋ 前後の文脈を表示');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveTextContent('− 文脈を閉じる');
  });

  it('UI-29: 展開ボタンのクリックが親カードと二重に発火しない', async () => {
    const { user } = setup();
    await user.click(toggle());
    // 二重発火なら展開→即収納で snippet のままになる。
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/縁側に腰を下ろしていた/)).toBeInTheDocument();
  });

  it('UI-30: context が空なら展開ボタンを出さず、クリックしても展開しない', async () => {
    const { user, card } = setup({ context: '' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    await user.click(card);
    expect(screen.getByText(/その夜は/)).toHaveTextContent('その夜は月が綺麗で');
  });

  it('UI-31: context が snippet と同じなら展開ボタンを出さない', async () => {
    const { user, card } = setup({ context: RESULT.snippet });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    await user.click(card);
    expect(screen.getByText(/その夜は/)).toHaveTextContent('その夜は月が綺麗で');
  });

  it('UI-32: 文脈の有無でカーソルを切り替える', () => {
    const { card } = setup();
    expect(card).toHaveClass('cursor-pointer');
    expect(toggle()).toHaveClass('cursor-pointer');

    cleanup();
    expect(setup({ context: '' }).card).toHaveClass('cursor-default');
  });

  it('UI-33: 作家名から作家別作品リストへリンクする', () => {
    setup();
    const link = screen.getByRole('link', {
      name: (content) => content.replace(/\s/g, '') === '夏目漱石',
    });
    expect(link).toHaveAttribute('href', RESULT.author_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('UI-34: author_url がなければリンクにしない', () => {
    setup({ author_url: null });
    expect(screen.getAllByRole('link')).toHaveLength(2); // 作品名と図書カードのみ
    expect(
      screen.getByText(RESULT.author, {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      })
    ).toBeInTheDocument();
  });

  it('UI-35: 作家名リンクのクリックでは展開しない', async () => {
    const { user } = setup();
    await user.click(
      screen.getByRole('link', { name: (content) => content.replace(/\s/g, '') === '夏目漱石' })
    );
    expect(screen.queryByText(/縁側に腰を下ろしていた/)).not.toBeInTheDocument();
  });
});
