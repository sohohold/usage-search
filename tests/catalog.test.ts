import { describe, it, expect, vi } from 'vitest';
import iconv from 'iconv-lite';
import {
  decodeText,
  pMap,
  parseCatalog,
  textUrlFromFileUrl,
  withRetry,
  RETRY_DELAYS,
} from '@/scripts/catalog';

const COLUMNS = [
  '作品ID',
  '作品名',
  '姓',
  '名',
  '図書カードURL',
  'テキストファイルURL',
  'テキストファイル符号化方式',
  '作品著作権フラグ',
  '人物著作権フラグ',
];

/** Build a catalog CSV from partial rows, filling unspecified columns with defaults. */
function csv(rows: Partial<Record<string, string>>[], { bom = false } = {}) {
  const defaults: Record<string, string> = {
    作品ID: '773',
    作品名: 'こころ',
    姓: '夏目',
    名: '漱石',
    図書カードURL: 'https://www.aozora.gr.jp/cards/000148/card773.html',
    テキストファイルURL: 'https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip',
    テキストファイル符号化方式: 'ShiftJIS',
    作品著作権フラグ: 'なし',
    人物著作権フラグ: 'なし',
  };
  const body = rows.map((r) => COLUMNS.map((c) => `"${{ ...defaults, ...r }[c] ?? ''}"`).join(','));
  return Buffer.from((bom ? '﻿' : '') + [COLUMNS.join(','), ...body].join('\n') + '\n');
}

describe('textUrlFromFileUrl', () => {
  it('IX-01: 青空文庫の zip URL を GitHub ミラーの txt URL に変換する', () => {
    expect(
      textUrlFromFileUrl('https://www.aozora.gr.jp/cards/000081/files/45630_ruby_23610.zip')
    ).toBe(
      'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/000081/files/45630_ruby_23610/45630_ruby_23610.txt'
    );
  });

  it('IX-02: http スキームの URL も変換できる', () => {
    expect(textUrlFromFileUrl('http://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip')).toBe(
      'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/000148/files/773_ruby_5968/773_ruby_5968.txt'
    );
  });

  it('IX-03: zip 以外の URL は null', () => {
    expect(textUrlFromFileUrl('https://www.aozora.gr.jp/cards/000148/card773.html')).toBeNull();
  });

  it('IX-04: cards/…/files/ の形でない zip は null', () => {
    expect(textUrlFromFileUrl('https://example.com/archive.zip')).toBeNull();
    expect(textUrlFromFileUrl('')).toBeNull();
  });
});

describe('parseCatalog', () => {
  it('IX-05: 著作権フラグが両方「なし」の行を採用する', () => {
    const rows = parseCatalog(csv([{}]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      work_id: '773',
      title: 'こころ',
      card_url: 'https://www.aozora.gr.jp/cards/000148/card773.html',
      encoding: 'ShiftJIS',
    });
  });

  it('IX-06: どちらかのフラグが「あり」の行は除外する', () => {
    expect(parseCatalog(csv([{ 作品著作権フラグ: 'あり' }]))).toHaveLength(0);
    expect(parseCatalog(csv([{ 人物著作権フラグ: 'あり' }]))).toHaveLength(0);
  });

  it('IX-07: テキストファイルURL が空・空白のみの行は除外する', () => {
    expect(parseCatalog(csv([{ テキストファイルURL: '' }]))).toHaveLength(0);
    expect(parseCatalog(csv([{ テキストファイルURL: '   ' }]))).toHaveLength(0);
  });

  it('IX-08: 著者名を「姓　名」で連結する', () => {
    expect(parseCatalog(csv([{ 姓: '夏目', 名: '漱石' }]))[0].author).toBe('夏目　漱石');
  });

  it('IX-09: 名が空でも末尾に全角スペースが残らない', () => {
    expect(parseCatalog(csv([{ 姓: 'ドイル', 名: '' }]))[0].author).toBe('ドイル');
    expect(parseCatalog(csv([{ 姓: '', 名: '漱石' }]))[0].author).toBe('漱石');
  });

  it('IX-10: 符号化方式が空なら ShiftJIS を既定にする', () => {
    expect(parseCatalog(csv([{ テキストファイル符号化方式: '' }]))[0].encoding).toBe('ShiftJIS');
  });

  it('IX-11: BOM 付き CSV でも列名が壊れない', () => {
    const rows = parseCatalog(csv([{}], { bom: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0].work_id).toBe('773');
  });
});

describe('decodeText', () => {
  it('IX-12: Shift_JIS のバイト列をデコードする', () => {
    const buf = iconv.encode('吾輩は猫である', 'Shift_JIS');
    expect(decodeText(buf, 'ShiftJIS')).toBe('吾輩は猫である');
  });

  it('IX-13: UTF-8 のバイト列をデコードする', () => {
    expect(decodeText(Buffer.from('吾輩は猫である', 'utf8'), 'UTF-8')).toBe('吾輩は猫である');
  });

  it('IX-14: 符号化方式の表記ゆれを UTF-8 として扱う', () => {
    const buf = Buffer.from('吾輩は猫である', 'utf8');
    for (const enc of ['UTF-8', 'utf8', 'unicode UTF-8']) {
      expect(decodeText(buf, enc)).toBe('吾輩は猫である');
    }
  });
});

describe('pMap', () => {
  it('IX-15: 完了順によらず結果は入力順に並ぶ', async () => {
    const delays = [30, 0, 15, 5];
    const results = await pMap(
      delays,
      (ms, i) => new Promise<number>((r) => setTimeout(() => r(i), ms)),
      2
    );
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('IX-16: 同時実行数が並列度を超えない', async () => {
    let active = 0;
    let peak = 0;
    await pMap(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
      },
      3
    );
    expect(peak).toBe(3);
  });

  it('IX-17: 空配列は空配列を返す', async () => {
    const fn = vi.fn();
    expect(await pMap([], fn, 5)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('IX-18: 1件でも reject すると全体が reject する', async () => {
    await expect(
      pMap([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }, 2)
    ).rejects.toThrow('boom');
  });
});

describe('withRetry', () => {
  it('IX-19: 3回失敗しても4回目に成功すれば成功として返る', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      if (++calls < 4) throw new Error(`attempt ${calls}`);
      return 'ok';
    }, [0, 0, 0]);

    expect(result).toBe('ok');
    expect(calls).toBe(4);
  });

  it('IX-20: 再試行を使い切ったら最後のエラーを throw する', async () => {
    // 既定の再試行は3回（1s / 2s / 4s 待ち）で、初回と合わせて計4回試行する。
    expect(RETRY_DELAYS).toEqual([1000, 2000, 4000]);

    let calls = 0;
    await expect(
      withRetry(async () => {
        throw new Error(`attempt ${++calls}`);
      }, [0, 0, 0])
    ).rejects.toThrow('attempt 4');
    expect(calls).toBe(4);
  });
});
