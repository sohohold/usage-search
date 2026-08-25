/**
 * テスト仕様書 §10.2。実物の Elasticsearch に対してだけ意味のある検証。
 * `ELASTICSEARCH_URL` が無ければファイルごとスキップされる（CI では service で起動する）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TOTAL_CHUNKS, TOTAL_WORKS } from './helpers/db';
import { createTestIndex, ES_URL, newClient } from './helpers/es';
import { resetEsClient } from '@/lib/es/client';
import { getStats } from '@/lib/search';

let cleanup: () => Promise<void>;
let index: string;
const previous = { backend: process.env.SEARCH_BACKEND, index: process.env.ELASTICSEARCH_INDEX };

describe.skipIf(!ES_URL)('Elasticsearch バックエンド', () => {
  beforeAll(async () => {
    const idx = await createTestIndex();
    cleanup = idx.cleanup;
    index = idx.index;
    process.env.SEARCH_BACKEND = 'elasticsearch';
    process.env.ELASTICSEARCH_INDEX = idx.index;
    resetEsClient();
  });

  afterAll(async () => {
    process.env.SEARCH_BACKEND = previous.backend;
    process.env.ELASTICSEARCH_INDEX = previous.index;
    resetEsClient();
    await cleanup();
  });

  it('ES-20: 設計どおりの索引を作れる', async () => {
    // createTestIndex() が通っている時点で作成は成功している。設定が意図どおりか確かめる。
    const client = newClient();
    try {
      const settings = await client.indices.getSettings({ index });
      const analysis = Object.values(settings)[0].settings?.index?.analysis;
      expect(analysis?.analyzer?.ngram_1).toBeDefined();
      expect(analysis?.analyzer?.ngram_2).toBeDefined();

      const mapping = await client.indices.getMapping({ index });
      const text = Object.values(mapping)[0].mappings.properties?.text;
      expect(text).toMatchObject({ type: 'text', analyzer: 'ngram_2' });
    } finally {
      await client.close();
    }
  });

  it('ES-21: 作品数と段落数を返す', async () => {
    expect(await getStats()).toEqual({ works: TOTAL_WORKS, chunks: TOTAL_CHUNKS });
  });
});
