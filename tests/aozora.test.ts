import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import {
  cleanAozoraText,
  splitIntoChunks,
  LINE_JOINER,
  MIN_CHUNK_LENGTH,
  MAX_CHUNK_LENGTH,
} from '@/scripts/aozora';

const RULE = '-'.repeat(55);
const LEGEND = '【テキスト中に現れる記号について】';
/** A high surrogate with no low after it, or a low surrogate with no high before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Wrap body text in the standard Aozora layout: title, legend block, body, colophon. */
function aozoraDoc(body: string, { legend = true } = {}) {
  const header = legend
    ? `こころ\n夏目漱石\n\n${RULE}\n${LEGEND}\n\n《》：ルビ\n（例）私《わたくし》は\n${RULE}\n`
    : `こころ\n夏目漱石\n\n${RULE}\n`;
  return `${header}\n${body}\n\n\n底本：「こころ」集英社文庫、集英社\n入力：j.utiyama\n`;
}

describe('cleanAozoraText', () => {
  it('AZ-01: ヘッダの題名・著者名が本文に残らない', () => {
    const out = cleanAozoraText(aozoraDoc('本文がここから始まります。'));
    expect(out).not.toContain('夏目漱石');
    expect(out.startsWith('本文がここから始まります。')).toBe(true);
  });

  it('AZ-02: 罫線が2本ある標準形式では凡例ブロックも2本目の罫線も残らない', () => {
    const out = cleanAozoraText(aozoraDoc('本文がここから始まります。'));
    expect(out).not.toContain(LEGEND);
    expect(out).not.toContain('：ルビ');
    expect(out).not.toContain('----');
    expect(out).toBe('本文がここから始まります。');
  });

  it('AZ-03: 凡例ブロックが無ければ1本目の罫線までを削る', () => {
    const out = cleanAozoraText(aozoraDoc('本文がここから始まります。', { legend: false }));
    expect(out).toBe('本文がここから始まります。');
  });

  it('AZ-04: 罫線を含まないテキストは全文を本文として扱う', () => {
    expect(cleanAozoraText('罫線のない本文です。')).toBe('罫線のない本文です。');
  });

  it('AZ-05: 底本：以降の書誌情報を落とす', () => {
    const out = cleanAozoraText('本文です。\n底本：「こころ」集英社文庫\n入力：だれか');
    expect(out).toBe('本文です。');
  });

  it('AZ-06: 半角コロンの 底本: でも落とす', () => {
    expect(cleanAozoraText('本文です。\n底本:「こころ」集英社文庫')).toBe('本文です。');
  });

  it('AZ-07: 底本を含まないテキストの末尾は削らない', () => {
    expect(cleanAozoraText('本文です。\n続きもあります。')).toBe(
      `本文です。${LINE_JOINER}続きもあります。`
    );
  });

  it('AZ-08: 縦棒つきルビを本体だけにする', () => {
    expect(cleanAozoraText('先生一人｜麦藁帽《むぎわらぼう》を')).toBe('先生一人麦藁帽を');
  });

  it('AZ-09: 縦棒なしのルビを本体だけにする', () => {
    expect(cleanAozoraText('私《わたくし》はその人を')).toBe('私はその人を');
  });

  it('AZ-10: 半角縦棒のルビにも対応する', () => {
    expect(cleanAozoraText('先生一人|麦藁帽《むぎわらぼう》を')).toBe('先生一人麦藁帽を');
  });

  it('AZ-11: ルビ記号が出力に残らない', () => {
    const out = cleanAozoraText('私《わたくし》は鎌倉《かまくら》へ｜行った《いった》。');
    expect(out).not.toMatch(/[《》｜]/);
  });

  it('AZ-12: 《 と 》 が別の行にある場合はルビとみなさない', () => {
    expect(cleanAozoraText('前の行《\n次の行》のつづき')).toBe(
      `前の行《${LINE_JOINER}次の行》のつづき`
    );
  });

  it('AZ-13: 全角の入力者注 ［＃…］ を削除する', () => {
    expect(cleanAozoraText('［＃５字下げ］一［＃「一」は中見出し］')).toBe('一');
  });

  it('AZ-14: 全角の外字注記 ※［＃…］ を削除し ※ も残さない', () => {
    expect(cleanAozoraText('※［＃「てへん＋劣」、第3水準1-84-77］いた')).toBe('いた');
  });

  it('AZ-15: 半角の [#…] / ※[#…] も削除する（旧形式）', () => {
    expect(cleanAozoraText('※[#「口+世」]本文[#「本文」に傍点]')).toBe('本文');
  });

  it('AZ-16: 注記を多数含む本文から ［＃ が1つも残らない', () => {
    const body = [
      '［＃２字下げ］上　先生と私［＃「上　先生と私」は大見出し］',
      '［＃５字下げ］一［＃「一」は中見出し］',
      '　私《わたくし》はその人を常に先生と呼んでいた。',
    ].join('\n');
    const out = cleanAozoraText(aozoraDoc(body));
    expect(out).not.toContain('［＃');
    expect(out).not.toContain('］');
    expect(out).toContain('私はその人を常に先生と呼んでいた。');
  });

  it('AZ-17: 段落内の改行は区切り記号に置き換えて1行にする', () => {
    // CRLF / CR も同じ扱いになる。
    expect(cleanAozoraText('一行目\r\n二行目\r三行目')).toBe(
      `一行目${LINE_JOINER}二行目${LINE_JOINER}三行目`
    );
    expect(cleanAozoraText('行末に空白あり  \n　次の行')).toBe(`行末に空白あり${LINE_JOINER}次の行`);
  });

  it('AZ-18: 空行は段落の区切りとして残し、連続分を1つにまとめる', () => {
    expect(cleanAozoraText('段落一。\n\n\n\n\n段落二。')).toBe('段落一。\n\n段落二。');
    // 空白だけの行も空行として扱う。
    expect(cleanAozoraText('段落一。\n　\n段落二。')).toBe('段落一。\n\n段落二。');
  });

  it('AZ-19: 前後の空白・空行を除去する', () => {
    expect(cleanAozoraText('\n\n　\n本文です。\n\n  \n')).toBe('本文です。');
  });

  it('AZ-20: 実データ（こころ抜粋）を整形すると注記・ルビ・書誌情報が残らない', () => {
    const raw = iconv.decode(
      fs.readFileSync(path.join(import.meta.dirname, 'fixtures/kokoro-excerpt.txt')),
      'Shift_JIS'
    );
    const out = cleanAozoraText(raw);

    expect(out).not.toContain('［＃');
    expect(out).not.toMatch(/[《》]/);
    expect(out).not.toContain('底本');
    expect(out).not.toContain('入力：');
    expect(out).not.toContain(LEGEND);
    expect(out).not.toContain('----');
    expect(out).not.toContain('夏目漱石');
    // The body starts at the first heading, which survives with its markup stripped.
    expect(out.startsWith('上　先生と私')).toBe(true);
    expect(out).toContain('私はその人を常に先生と呼んでいた。');
    // 各段落は1行にまとまり、段落の区切りだけが空行として残る。
    for (const paragraph of out.split('\n\n')) {
      expect(paragraph).not.toContain('\n');
    }
  });
});

describe('splitIntoChunks', () => {
  it('CH-01: 空行区切りの段落ごとに1チャンクを作る', () => {
    const first = 'これは最初の段落です。十五文字以上あります。';
    const second = 'これは二つ目の段落です。こちらも十五文字以上。';
    expect(splitIntoChunks(`${first}\n\n${second}`)).toEqual([first, second]);
  });

  it('CH-02: 15文字未満の段落は捨てる', () => {
    expect(splitIntoChunks('みじかい。\n\nこちらは十五文字以上ある段落です。')).toEqual([
      'こちらは十五文字以上ある段落です。',
    ]);
  });

  it('CH-03: 境界値 14文字は捨て、15文字は採用する', () => {
    expect(splitIntoChunks('あ'.repeat(MIN_CHUNK_LENGTH - 1))).toEqual([]);
    expect(splitIntoChunks('あ'.repeat(MIN_CHUNK_LENGTH))).toEqual([
      'あ'.repeat(MIN_CHUNK_LENGTH),
    ]);
  });

  it('CH-04: 上限以下の段落は分割しない', () => {
    const para = 'あ'.repeat(MAX_CHUNK_LENGTH);
    expect(splitIntoChunks(para)).toEqual([para]);
  });

  it('CH-05: 上限超の段落を文末記号の直後で分割し、各チャンクが上限以下になる', () => {
    const chunks = splitIntoChunks('これは文です。'.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
      expect(c.endsWith('。')).toBe(true);
    }
  });

  it('CH-06: 末尾断片が捨てられないかぎり、分割で文字が欠落も重複もしない', () => {
    const para = 'これは文です。'.repeat(200);
    const chunks = splitIntoChunks(para);

    // 末尾断片が15文字以上なので CH-07 の切り捨ては起きない。
    expect(chunks.at(-1)!.length).toBeGreaterThanOrEqual(MIN_CHUNK_LENGTH);
    expect(chunks.join('')).toBe(para);
  });

  it('CH-07: 分割後の末尾断片が15文字未満なら捨てる', () => {
    // 400文字ちょうどの文 + 5文字の文。後半は短すぎるので落ちる。
    const para = 'あ'.repeat(MAX_CHUNK_LENGTH - 1) + '。' + 'いろは。';
    const chunks = splitIntoChunks(para);
    expect(chunks).toEqual(['あ'.repeat(MAX_CHUNK_LENGTH - 1) + '。']);
  });

  it('CH-08: 文末記号のない上限超の段落も上限以下に強制分割する', () => {
    const chunks = splitIntoChunks('あ'.repeat(1000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
    }
    expect(chunks.join('')).toBe('あ'.repeat(1000));
  });

  it('CH-11: 上限の切れ目がサロゲートペアに重なっても分断しない', () => {
    // 「𠮟」は補助面の文字なので UTF-16 では2コードユニット。399文字の後に置くと、
    // 上限400の切れ目がちょうどペアの内側に落ちる。
    const para = 'あ'.repeat(MAX_CHUNK_LENGTH - 1) + '𠮟' + 'い'.repeat(100);
    const chunks = splitIntoChunks(para);

    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
      // 孤立したサロゲートは SQLite へ書き出す時点で置換文字に化ける。
      expect(c).not.toMatch(LONE_SURROGATE);
    }
    expect(chunks.join('')).toBe(para);
    expect(chunks.filter((c) => c.includes('𠮟'))).toHaveLength(1);
  });

  it('CH-12: 15文字未満の文で始まる上限超の段落でも各チャンクが上限以下になる', () => {
    // 短すぎて単独では切り出せない文の後ろに、分割できない長さが続くケース。
    const para = '短い。' + 'あ'.repeat(500);
    const chunks = splitIntoChunks(para);

    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
    }
    expect(chunks.join('')).toBe(para);
  });

  it('CH-09: 空文字・空白のみは空配列を返す', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n\n  \n')).toEqual([]);
  });

  it('CH-10: 各チャンクの前後に空白が残らない', () => {
    const chunks = splitIntoChunks('  　これは十五文字以上ある段落です。　  \n\n  もうひとつの十五文字以上の段落。  ');
    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      expect(c).toBe(c.trim());
    }
  });
});
