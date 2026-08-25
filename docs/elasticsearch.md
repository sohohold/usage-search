# Elasticsearch バックエンド

1〜2文字のクエリを引けるようにするために、検索を Elasticsearch へ移します。
このドキュメントは、解析方式をどう決めたか（実測つき）、索引と検索の設計、運用と費用、
移行手順をまとめたものです。

要件は [テスト仕様書 §9](./test-spec.md)（短いクエリ）と §10（Elasticsearch バックエンド）にあります。
SQLite のまま解決する案の比較は [1〜2文字クエリの検索方式](./short-query-search.md) に残してあります。

---

## 1. 解析方式は n-gram（kuromoji は使わない）

**用例検索の要件は「任意の部分文字列に一致すること」**で、語の切れ目に一致することではありません。
形態素解析はこの要件を満たしません。Elasticsearch と同じ解析エンジンである Lucene 10.5.1 で、
実コーパス（青空文庫400作品 / 8,360チャンク / 247万文字）を索引して測りました。

### ヒット件数（正解 = 本文が部分文字列を含むチャンク数）

| クエリ | 正解 | kuromoji | ユニグラム | バイグラム | 1-2gram混在 |
|---|---|---|---|---|---|
| `の` | 7,995 | **検索不可** | 7,995 | 検索不可 | 7,995 |
| `ぬ` | 1,444 | **検索不可** | 1,444 | 検索不可 | 1,444 |
| `こと` | 3,101 | **検索不可** | 3,101 | 3,101 | 3,101 |
| `ということ` | 132 | **検索不可** | 132 | 132 | 132 |
| `月` | 1,160 | **223** | 1,160 | 検索不可 | 1,160 |
| `月が` | 36 | **223** | 36 | 36 | 36 |
| `人間の心` | 11 | **10** | 11 | 11 | 11 |
| `三日月` | 14 | 14 | 14 | 14 | 14 |

kuromoji が「検索不可」なのは、既定の品詞フィルタとストップワードが助詞・助動詞を落とすためで、
**「の」「こと」「ということ」はクエリのトークンが空になり、検索そのものが成立しません**。
「月」の223件は、形態素の境界に一致した出現だけを拾った結果で、**再現率19%**です。
「月が」が223件と正解より多いのは、「が」が落ちて実質「月」を検索してしまうためで、
少なすぎるだけでなく**誤ったヒットも返します**。

### n-gram の索引サイズと速度（同コーパス、1セグメントに最適化後）

| 構成 | 索引サイズ | 1文字 | 2文字 | 3文字以上 |
|---|---|---|---|---|
| kuromoji | 6.7MB | 使用不可 | 使用不可 | 0.05〜0.23ms |
| ユニグラムのみ | 8.5MB | 0.19〜0.71ms | 0.39〜1.21ms | 0.46〜1.76ms |
| バイグラムのみ | 12.0MB | 不可 | 0.05〜0.12ms | 0.04〜0.17ms |
| 1-2gram を1フィールドに混在 | 16.5MB | 0.25〜0.62ms | 0.20〜0.88ms | 0.10〜0.41ms |
| **ユニグラム + バイグラムの2フィールド** | **16.5〜17.3MB** | **0.03〜0.63ms** | **0.05〜0.24ms** | **0.04〜0.21ms** |

採用は最後の構成です。混在フィールドと索引サイズはほぼ同じで、2文字以上が明確に速い
（`こと` で 0.88ms → 0.24ms）。クエリ長でフィールドを選ぶだけなので実装も単純です。

**完全性の検証**: コーパスから無作為抽出した部分文字列（1・2・3・4・7文字 × 各60件、計300件）で、
ユニグラム／バイグラムいずれも**不一致0件**。重なり n-gram のフレーズ一致は部分文字列一致と等価です。

### ハイライトも実測

Lucene の UnifiedHighlighter（Elasticsearch の既定ハイライタと同じもの）で、1文字クエリでも
一致した1文字だけが囲まれることを確認しました。

```
'月'      → （四<mark>月</mark>十六日）
'月が'    → 造り物の柳に灯入りの<mark>月が</mark>出る。
'人間の心' → げに<mark>人間の心</mark>こそ、無明の闇も異らね、
```

いま SQLite の `snippet()` で作っているハイライトを、そのまま Elasticsearch に任せられます。

### 副産物: プラグインが要らない

`ngram` トークナイザーは Elasticsearch 本体の機能です。kuromoji を使わないので
`analysis-kuromoji` プラグインのインストールが不要で、素のイメージ・素のマネージドサービスで動きます。

---

## 2. 索引の設計

実体は `lib/es/index-settings.ts`。要点だけ:

```jsonc
{
  "settings": {
    "index": {
      "number_of_shards": 1,          // 全件でも約800MB。1シャードで足りる
      "refresh_interval": "30s",      // 検索専用。投入直後の可視性は要らない
      "max_result_window": 20000      // 「もっと見る」の深さの上限
    },
    "analysis": {
      "tokenizer": {
        "ngram_1_tokenizer": { "type": "ngram", "min_gram": 1, "max_gram": 1 },
        "ngram_2_tokenizer": { "type": "ngram", "min_gram": 2, "max_gram": 2 }
      },
      "analyzer": {
        // token_chars を指定しない = 約物・空白も落とさない。「、」「。」も検索できる
        "ngram_1": { "type": "custom", "tokenizer": "ngram_1_tokenizer", "filter": ["lowercase"] },
        "ngram_2": { "type": "custom", "tokenizer": "ngram_2_tokenizer", "filter": ["lowercase"] }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "text": { "type": "text", "analyzer": "ngram_2", "fields": { "uni": { "type": "text", "analyzer": "ngram_1" } } }
    }
  }
}
```

- `min_gram`/`max_gram` の差は0なので、`index.max_ngram_diff`（既定1）の変更は不要です。
- `lowercase` で英字の大小を同一視します（現行 trigram の挙動を踏襲）。
- 全角・半角の同一視（`icu_normalizer` や `cjk_width`）は入れていません。文字数が変わる正規化は
  ハイライト位置に影響するため、別途判断します。

## 3. 検索リクエスト

`lib/es/query.ts`。クエリ長でフィールドを選び、`match_phrase` で引きます。

```jsonc
{
  "from": 0,
  "size": 21,                       // limit + 1。総件数は数えない（track_total_hits: false）
  "query": { "match_phrase": { "text.uni": "月" } },   // 2文字以上なら "text"
  "sort": ["_score", { "work_id": "asc" }, { "seq": "asc" }],
  "highlight": {
    "pre_tags": ["<mark>"], "post_tags": ["</mark>"],
    "encoder": "html",              // 本文中の < & をエスケープさせる
    "number_of_fragments": 0,       // 断片に切らず段落全体を返す（1チャンク最大400文字）
    "fields": { "text.uni": {} }
  }
}
```

- **`match_phrase` を使う理由**: 重なり n-gram のフレーズ一致が部分文字列一致と等価だから。
  `match`（OR 結合）だと語順を無視した誤ヒットになります。
- **並び順**: スコアだけだと同点が大量に出てページングが揺れるため、`work_id` と `seq` で
  決定的にします。`seq` は SQLite の rowid（作品順・段落順の通し番号）。
- **`encoder: "html"`**: 現在テスト仕様書で「対象外」にしている
  「`snippet` の HTML エスケープ」がこれで閉じます。
- **スニペット**: 段落全体のハイライトから、最初の一致の前後24文字を
  `narrowHighlight()` が切り出します。タグと実体参照を割らないよう、表示上の文字境界でのみ切ります。
  カード展開時に見せる `context` は段落全体そのものです。

## 4. 構成

```
ブラウザ → Next.js（Vercel）
              ├─ lib/search.ts  … SEARCH_BACKEND で振り分け（移行期間だけの分岐）
              ├─ lib/db.ts      … 現行の SQLite / Turso
              └─ lib/es/*       … Elasticsearch
                                     ↑ scripts/es-load.ts が SQLite から流し込む
```

インデクサ（`scripts/build-index.ts`）はそのままで、青空文庫のダウンロード・整形・段落分割は
SQLite に書き続けます。`scripts/es-load.ts` はその SQLite を読んで Elasticsearch に投入するだけです。

- 取得と整形の実績あるコードに手を入れない
- ES を作り直すたびに18,567作品をダウンロードし直さなくてよい（SQLite が中間成果物として残る）
- 既存の Reindex ワークフローと共存できる

投入後は**エイリアスを張り替えて切り替えます**（`aozora-chunks` → `aozora-chunks-YYYYMMDD`）。
Turso では新しいDBを作って Vercel の環境変数を手で変える必要がありましたが、
エイリアスなら**アプリの設定を触らずに一瞬で切り替わり、失敗したら戻せます**。

### 環境変数

| 変数 | 用途 |
|---|---|
| `SEARCH_BACKEND` | `elasticsearch` で ES を見る。未設定なら従来どおり SQLite |
| `ELASTICSEARCH_URL` | 接続先 |
| `ELASTICSEARCH_API_KEY` | API キー（自前ホストで認証なしなら不要） |
| `ELASTICSEARCH_INDEX` | 検索が読むエイリアス名（既定 `aozora-chunks`） |
| `NEXT_PUBLIC_MIN_QUERY_LENGTH` | クライアントが自動検索を始める文字数。ES に切り替えるとき `1` にする |

サーバ側の下限は `lib/search.ts` の `minQueryLength()` がバックエンドから決めます
（SQLite なら3、Elasticsearch なら1）。クライアント側は上の `NEXT_PUBLIC_` 変数で、
**切り替えるときは2つ一緒に設定します**。片方だけだと「自動検索は走らないが、
Enter を押せば1文字でも引ける」という中途半端な状態になります（壊れはしません）。

## 5. ローカルとCI

```bash
docker compose up -d --wait elasticsearch      # npm run es:up
npm run index -- --limit 200                   # SQLite を作る（初回のみ）
ELASTICSEARCH_URL=http://localhost:9200 npm run index:es
SEARCH_BACKEND=elasticsearch ELASTICSEARCH_URL=http://localhost:9200 \
  NEXT_PUBLIC_MIN_QUERY_LENGTH=1 npm run dev
```

テストは2段構えです。

| テスト | 実行条件 |
|---|---|
| `tests/es-query.test.ts`（ES-01〜13） | 常に走る。リクエストの組み立てとスニペット加工は純粋関数なので ES は要らない |
| `tests/short-query.test.ts`（SQ-01〜13） | `ELASTICSEARCH_URL` があるときだけ走る。実物の索引を引いて件数を突き合わせる |

CI では両方のジョブに `elasticsearch:9.5.2` の service を足してあり、
e2e ジョブは実データ50作品を ES に載せ替えて、1文字・2文字の検索が通ることまで確認します。

## 6. 費用と運用

| 選択肢 | 目安 | 備考 |
|---|---|---|
| Elastic Cloud（ホスト型） | 最小構成で **$40/月**前後 | 1GB RAM / 45GB ストレージの参考構成 |
| Elastic Cloud Serverless | 小規模で **$25/月**前後 | 取り込み量と保存量の従量課金 |
| 自前ホスト（VPS 2〜4GB） | **$12〜24/月** | バックアップ・アップグレードは自前 |

全件（18,567作品）の索引は約800MB＋`_source`（本文）で、**1〜1.2GB** の見込みです
（400作品17.3MB × 46.4 からの外挿）。ヒープは2GBあれば足ります。

現行の Turso は無料枠で収まっていたので、**これは新たに発生する固定費です**。
それでも Elasticsearch を選ぶ理由は、1〜2文字が引けること自体は SQLite 側の
2-gram 索引でも達成できる（[比較](./short-query-search.md)）一方で、次が付いてくるからです。

- ハイライトが既製品（1文字でも正しく、HTMLエスケープ込み）
- `collapse` による作品ごとの結果の間引き（テスト仕様書 SQ-10「結果の多様性」の解として有力）
- スコアリング、集計（作家別の用例数など）、シャード分割による将来の拡張余地
- エイリアスによる無停止の索引切り替え

逆に増えるものも正直に書いておきます。**常時稼働のサーバ1台**、その監視とバージョンアップ、
CI の実行時間（ES の起動ぶん）、そして「Next.js と Turso だけ」という構成の単純さの喪失です。

## 7. 移行手順

| 段階 | 内容 | 本番への影響 |
|---|---|---|
| 1 | ES バックエンドとテスト・CI を入れる ← **このPR** | なし（既定は SQLite のまま） |
| 2 | ES を用意し、`npm run index -- --limit 全件` の SQLite から `npm run index:es` で投入 | なし |
| 3 | Vercel に `SEARCH_BACKEND=elasticsearch` ほかを設定 | ここで1〜2文字が有効になる |
| 4 | `NEXT_PUBLIC_MIN_QUERY_LENGTH=1` を設定して再デプロイ | 1文字から自動検索が走る |
| 5 | 問題がなければ `lib/db.ts` と `lib/search.ts` の分岐、Turso を撤去 | なし |

戻すときは `SEARCH_BACKEND` を消すだけで SQLite に戻ります（段階5より前に限る）。

## 8. 未検証の点

この環境から Elasticsearch のバイナリ・イメージを取得できなかったため、**実際の Elasticsearch に
繋いだ動作確認はできていません**。解析とクエリの意味論は同じエンジンである Lucene 10.5.1 で
検証済みですが、次は CI（または手元の `docker compose up`）での初回実行で確かめてください。

- `scripts/es-load.ts` の bulk 投入とエイリアス張り替え
- `tests/short-query.test.ts`（SQ-01〜13）の実行結果
- ハイライトの `encoder: "html"` と `number_of_fragments: 0` の組み合わせ
- 全件を投入したときの索引サイズと1文字クエリの実応答時間

## 付録: 測定の再現手順

```bash
npx tsx scripts/build-index.ts --limit 400     # DB_PATH=data/bench.db
# 本文を JSONL に書き出し、Lucene 10.5.1（lucene-core / analysis-common /
# analysis-kuromoji / highlighter）で kuromoji・ユニグラム・バイグラム・混在の
# 4通りを索引し、件数・レイテンシ・ハイライトを比較した。
```
