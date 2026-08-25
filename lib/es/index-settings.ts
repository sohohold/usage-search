import type { Client } from '@elastic/elasticsearch';

/**
 * 索引の設定。1〜2文字を引けることが要件なので、解析は n-gram で行う。
 *
 * - `text`     … バイグラム。2文字以上のクエリを `match_phrase` で厳密一致させる
 * - `text.uni` … ユニグラム。1文字のクエリ専用
 *
 * 形態素解析（kuromoji）を使わないのは、用例検索の要件が「任意の部分文字列一致」だから。
 * 実測では kuromoji は「月」で再現率19%（1,160件中223件）、「の」「こと」に至っては
 * 品詞フィルタで落ちて検索できない。詳細は docs/elasticsearch.md を参照。
 * 副産物として analysis-kuromoji プラグインが不要になり、素の Elasticsearch で動く。
 */
export const INDEX_SETTINGS = {
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0,
      refresh_interval: '30s',
      // ngram(1,1) と ngram(2,2) はどちらも差が0。既定値1のままで足りる。
      max_ngram_diff: 1,
      // 「もっと見る」の深いページング上限。from + size がこれを超えると 400 になる。
      max_result_window: 20_000,
    },
    analysis: {
      tokenizer: {
        ngram_1_tokenizer: { type: 'ngram', min_gram: 1, max_gram: 1 },
        ngram_2_tokenizer: { type: 'ngram', min_gram: 2, max_gram: 2 },
      },
      analyzer: {
        // token_chars を指定しない = 記号や空白も落とさない。約物をまたぐ検索に必要。
        ngram_1: { type: 'custom', tokenizer: 'ngram_1_tokenizer', filter: ['lowercase'] },
        ngram_2: { type: 'custom', tokenizer: 'ngram_2_tokenizer', filter: ['lowercase'] },
      },
    },
  },
  mappings: {
    // 想定外のフィールドが入ったら気付けるように、動的マッピングは切る。
    dynamic: 'strict',
    properties: {
      work_id: { type: 'keyword' },
      title: { type: 'keyword' },
      author: { type: 'keyword' },
      author_url: { type: 'keyword', index: false },
      card_url: { type: 'keyword', index: false },
      // 作品内での段落の並び。同点時の順序を決めるために使う（ページングの安定性）。
      seq: { type: 'integer', index: false },
      text: {
        type: 'text',
        analyzer: 'ngram_2',
        fields: {
          uni: { type: 'text', analyzer: 'ngram_1' },
        },
      },
    },
  },
} as const;

/** 索引を1つ作る。既にあれば例外。 */
export async function createIndex(client: Client, index: string): Promise<void> {
  await client.indices.create({ index, ...(INDEX_SETTINGS as object) });
}
