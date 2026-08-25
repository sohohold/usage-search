/**
 * テスト仕様書 §10「Elasticsearch バックエンド」のうち、Elasticsearch を起動せずに
 * 検証できる部分（リクエストの組み立てとハイライトの加工）。
 * 実際に索引を引く検証は tests/short-query.test.ts（要 ELASTICSEARCH_URL）。
 */
import { describe, it, expect } from 'vitest';
import { buildSearchBody, narrowHighlight, queryField, toSearchResult } from '@/lib/es/query';
import { INDEX_SETTINGS } from '@/lib/es/index-settings';

describe('クエリの組み立て', () => {
  it('ES-01: 1文字はユニグラム、2文字以上はバイグラムのフィールドを引く', () => {
    expect(queryField('月')).toBe('text.uni');
    expect(queryField('月が')).toBe('text');
    expect(queryField('月が綺麗')).toBe('text');
    // サロゲートペアは1文字。UTF-16 の長さで数えると2文字になってしまう。
    expect(queryField('𠮟')).toBe('text.uni');
    expect('𠮟'.length).toBe(2);
  });

  it('ES-02: 部分文字列一致は match_phrase で表す', () => {
    expect(buildSearchBody('月', 20, 0).query).toEqual({ match_phrase: { 'text.uni': '月' } });
    expect(buildSearchBody('月が綺麗', 20, 0).query).toEqual({ match_phrase: { text: '月が綺麗' } });
  });

  it('ES-03: size は limit+1、総件数は数えない', () => {
    const body = buildSearchBody('月', 20, 40);
    expect(body.size).toBe(21);
    expect(body.from).toBe(40);
    expect(body.track_total_hits).toBe(false);
  });

  it('ES-04: 並び順はスコア → 作品ID → 段落番号', () => {
    expect(buildSearchBody('月', 20, 0).sort).toEqual(['_score', { work_id: 'asc' }, { seq: 'asc' }]);
  });

  it('ES-05: ハイライトは段落全体を HTML エスケープ付きで返す', () => {
    const hl = buildSearchBody('月', 20, 0).highlight;
    expect(hl.number_of_fragments).toBe(0);
    expect(hl.encoder).toBe('html');
    expect(hl.pre_tags).toEqual(['<mark>']);
    expect(hl.fields).toEqual({ 'text.uni': {} });
  });
});

describe('スニペットの切り出し', () => {
  const long = (ch: string, n: number) => ch.repeat(n);

  it('ES-06: 最初の一致の前後だけを残し、切った側に … を付ける', () => {
    const html = `${long('あ', 100)}<mark>月</mark>${long('い', 100)}`;
    const snippet = narrowHighlight(html, 24);
    expect(snippet).toBe(`…${long('あ', 24)}<mark>月</mark>${long('い', 24)}…`);
  });

  it('ES-07: 切り詰めが不要なら … を付けない', () => {
    const html = `あい<mark>月</mark>うえ`;
    expect(narrowHighlight(html, 24)).toBe('あい<mark>月</mark>うえ');
  });

  it('ES-08: タグや実体参照を途中で割らない', () => {
    // `&amp;` は表示上1文字。前後3文字を残すなら「あ・あ・&amp;」で3文字と数える。
    const html = `${long('あ', 30)}&amp;<mark>月</mark>&lt;${long('い', 30)}`;
    const snippet = narrowHighlight(html, 3);
    expect(snippet).toBe('…ああ&amp;<mark>月</mark>&lt;いい…');
    // 実体参照が途中で割れていない（`&` と `;` が対で残っている）。
    expect(snippet).toContain('&amp;');
    expect(snippet).toContain('&lt;');
    expect(snippet.match(/<mark>/g)).toHaveLength(1);
  });

  it('ES-09: 一致が複数あれば最初から最後までを含める', () => {
    const html = `<mark>月</mark>あい<mark>月</mark>`;
    expect(narrowHighlight(html, 24)).toBe('<mark>月</mark>あい<mark>月</mark>');
  });

  it('ES-10: ハイライトがない応答は本文で代替する', () => {
    const hit = { _source: { title: 'こころ', author: '夏目　漱石', card_url: 'https://example.com/c', text: '本文' } };
    const r = toSearchResult(hit, 'text');
    expect(r.context).toBe('本文');
    expect(r.snippet).toBe('本文');
    expect(r.author_url).toBeNull();
  });

  it('ES-11: ヒットから検索結果の形に移す', () => {
    const hit = {
      _source: {
        title: 'こころ',
        author: '夏目　漱石',
        author_url: 'https://www.aozora.gr.jp/index_pages/person148.html',
        card_url: 'https://example.com/cards/card773.html',
        text: 'その夜は月が綺麗で',
      },
      highlight: { text: ['その夜は<mark>月が綺麗</mark>で'] },
    };
    expect(toSearchResult(hit, 'text')).toEqual({
      title: 'こころ',
      author: '夏目　漱石',
      author_url: 'https://www.aozora.gr.jp/index_pages/person148.html',
      card_url: 'https://example.com/cards/card773.html',
      snippet: 'その夜は<mark>月が綺麗</mark>で',
      context: 'その夜は<mark>月が綺麗</mark>で',
    });
  });
});

describe('索引の設定', () => {
  it('ES-12: 1文字用と2文字用の n-gram を持つ', () => {
    const { tokenizer, analyzer } = INDEX_SETTINGS.settings.analysis;
    expect(tokenizer.ngram_1_tokenizer).toEqual({ type: 'ngram', min_gram: 1, max_gram: 1 });
    expect(tokenizer.ngram_2_tokenizer).toEqual({ type: 'ngram', min_gram: 2, max_gram: 2 });
    // token_chars を指定しない = 約物や空白も落とさない（SQ-05）。
    expect(analyzer.ngram_1).not.toHaveProperty('token_chars');
    expect(analyzer.ngram_2).not.toHaveProperty('token_chars');
    // 英字の大小同一視（SQ-06）。
    expect(analyzer.ngram_1.filter).toContain('lowercase');
    expect(analyzer.ngram_2.filter).toContain('lowercase');
  });

  it('ES-13: 本文はバイグラム、その下にユニグラムのサブフィールドを持つ', () => {
    const text = INDEX_SETTINGS.mappings.properties.text;
    expect(text.analyzer).toBe('ngram_2');
    expect(text.fields.uni.analyzer).toBe('ngram_1');
    // 想定外の項目が紛れ込んだら投入時に落とす。
    expect(INDEX_SETTINGS.mappings.dynamic).toBe('strict');
  });
});
