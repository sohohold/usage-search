# 青空用例検索

青空文庫に収録された、著作権の消滅した作品の全文から任意のワードを検索し、その用例・文脈を表示するサービスです。インデックス済みの作品数・段落数はアプリ画面にリアルタイムで表示されます。

## アーキテクチャ

```
ブラウザ
    ↓
Next.js App Router（React 19 + Tailwind CSS 4）
  ├─ app/page.tsx + components/*  ...... UI（クライアントコンポーネント）
  └─ app/api/{search,stats}/route.ts ... Route Handlers（サーバー）
    ↓ @libsql/client
Turso（libSQL）— SQLite FTS5 + trigramトークナイザー
```

- **検索エンジン**: SQLite FTS5 + trigramトークナイザー
  - 外部の全文検索サービス不要
  - 日本語の任意部分文字列マッチに対応
- **フロントエンド/バックエンド**: Next.js 1つのアプリに統合（別リポジトリ・別プロセスの分離なし）
- **データベース**: [Turso](https://turso.tech/)（libSQL）。ローカル開発では `file:` URLでSQLiteファイルをそのまま利用できるため、Tursoアカウントなしでも動作確認可能
- **デプロイ**: Vercelなど、Next.jsをホスティングできる環境 + Turso
- **アナリティクス**: Vercel Analytics

## セットアップ

前提: Node.js 22以上（CIで使用しているバージョン）

### 1. 依存関係のインストール

```bash
npm install
```

### 2. インデックス作成（初回のみ・全件だと20〜60分程度）

青空文庫の目録とテキストをGitHubミラー（[aozorabunko/aozorabunko](https://github.com/aozorabunko/aozorabunko) の目録CSVと [aozorahack/aozorabunko_text](https://github.com/aozorahack/aozorabunko_text) の本文）からダウンロードし、ローカルのSQLiteファイル（既定 `data/aozora.db`）にFTS5インデックスを構築します。

```bash
# 著作権の消滅した全作品をインデックス
npm run index

# テスト用: 最初の100作品だけ
npm run index -- --limit 100

# 中断から再開（インデックス済みの作品をスキップ）
npm run index -- --resume
```

環境変数で保存先を変更できます: `DATA_DIR`（ダウンロードファイルの格納先、既定 `./data`）、`DB_PATH`（SQLiteファイルの出力先、既定 `<DATA_DIR>/aozora.db`）。

> **再インデックスが必要になる変更**: 本文の整形規則（入力者注や凡例ブロックの除去、段落の分割、
> 改行の扱い）や、目録から取り込む項目（作家別作品リストのURLなど）を変えた場合、
> 既存のインデックスには反映されないため作り直しが必要です。
> 作り直すまでは、その項目を使う表示（作家名のリンクなど）が出ないだけで、検索自体は動きます。
> 整形規則は [テスト仕様書 §2・§3](./docs/test-spec.md) にまとまっています。
> ローカルで作り直さずに [Reindex ワークフロー](#再インデックスgithub-actions)を使うこともできます。

### 再インデックス（GitHub Actions）

ローカル環境なしでインデックスを作り直せます。Actions の **Reindex** ワークフローを手動実行すると、
全件インデックスを構築し、Turso に**新しいデータベースとして**取り込みます。

| 入力 | 内容 |
|---|---|
| `db_name` | Turso のデータベース名（空なら `aozora-YYYYMMDD`） |
| `limit` | 先頭 N 作品だけ構築（空なら全件・20〜60分） |
| `resume` | 前回の中断地点から再開する |
| `skip_upload` | 構築と検証だけ行い、Turso には取り込まない |

実行前にリポジトリシークレット `TURSO_API_TOKEN`（Turso のプラットフォームトークン。
データベーストークンではありません）を登録してください。

動作中の本番環境は影響を受けません。Vercel の環境変数を手で新しいデータベースに向けるまで、
アプリは旧データベースを参照し続けます。失敗した構築が本番に出ることはなく、
旧データベースはロールバック用にそのまま残ります。切り替え手順は実行結果のサマリに表示されます。

Turso は既存データベースの上書きに対応していないため、実行のたびに別名のデータベースが作られます。
切り替えを確認したら、旧データベースは `turso db destroy <旧名>` で削除してください。

> 認証トークンはワークフローでは発行も出力もしません。このリポジトリは public で、
> ジョブログ・サマリ・artifact は誰でも閲覧できるためです。トークンは Turso ダッシュボードから発行してください。

### 3. アプリの起動

**ローカルのSQLiteファイルをそのまま使う場合**（Tursoアカウント不要）:

```bash
TURSO_DATABASE_URL=file:./data/aozora.db npm run dev
```

**Tursoにホストする場合**は、作成したSQLiteファイルをTursoデータベースへ取り込みます（ファイルサイズ上限2GB）。

```bash
turso db create aozora --from-file data/aozora.db
turso db show aozora --url
turso db tokens create aozora
```

```bash
# .env.local
TURSO_DATABASE_URL=libsql://<取得したURL>
TURSO_AUTH_TOKEN=<取得したトークン>
```

```bash
npm run dev             # 開発サーバー
npm run build && npm run start   # 本番ビルド・起動
```

ブラウザで http://localhost:3000 を開く。

### npmスクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー起動 |
| `npm test` | テスト実行（Vitest） |
| `npm run test:watch` | テストのウォッチ実行 |
| `npm run test:coverage` | カバレッジ付きでテスト実行 |
| `npm run index` | インデクサー実行（`scripts/build-index.ts`） |

## 検索仕様

- 3文字以上のワードが対象（trigramトークナイザーの制約上、2文字以下は検索不可）
- SQLite FTS5 trigramによる完全部分一致検索
- インデックスの単位は段落。段落内の改行は ` / ` に置き換えて1行にまとめ、400文字を超える段落は分割
- 1リクエストあたり既定20件（最大50件）取得。「もっと見る」でオフセットページングし、追加分をこれまでの結果に継続表示（表示件数の上限なし）
- 各結果はKWIC形式の前後文脈付きで表示。結果カードをクリックするとより広い範囲の文脈に展開表示。段落が短く、広げても表示が変わらない場合は展開しない（「前後の文脈を表示」も出さない）
- 作品名・図書カードは図書カードへ、作家名は青空文庫の「作家別作品リスト」へリンク
- 3文字以上の入力は400msデバウンスして自動検索。入力中に前のリクエストが残っていれば中断し、最新のクエリを優先
- 2文字以下は自動検索しないが、Enterまたは検索ボタンで明示的に送信でき、その場合はサーバーが理由（3文字以上必要）を返す
- 検索結果・統計情報はCDNで24時間キャッシュ（`stale-while-revalidate`で最大7日間）

## テスト

このプロジェクトはテスト駆動で開発します。**先に [テスト仕様書](./docs/test-spec.md) の表を書き、
それからテストと実装を書く**という順序です。テスト名の先頭には仕様書の項目 ID
（`AZ-02`、`API-09` など）が入っているので、失敗したテストから仕様書の該当行を引けます。

```bash
npm test              # 全件実行
npm run test:watch    # ウォッチ実行
npm run test:coverage # カバレッジ付き
```

- ランナーは Vitest。既定は Node 環境で、DOM が必要なファイルだけ先頭の
  `// @vitest-environment jsdom` で切り替えます
- `lib/db.ts` のテストはモックせず、一時ファイル上に本物の SQLite + FTS5(trigram) を作って検証します
- Route Handler は直接 `import` して `NextRequest` を渡すため、サーバー起動は不要です

### CI

GitHub Actions（`.github/workflows/ci.yml`）で以下を実行:

- 型チェック（`tsc --noEmit`）、`npm test`、本番ビルド
- E2Eスモークテスト: 50作品分のインデックスを実際に構築し、索引済みテキストに青空文庫の注記・
  凡例が残っていないことを確認したうえで、開発サーバーを起動して `/api/stats` と `/api/search`
  の応答、および2文字以下のクエリが400で拒否されることを確認

## データソース

[青空文庫](https://www.aozora.gr.jp/) — 著作権の消滅した作品を公開するデジタル図書館。
インデックス作成時は青空文庫のGitHubミラー（目録: aozorabunko/aozorabunko、本文: aozorahack/aozorabunko_text）からダウンロードします。

## ライセンス

[MIT](./LICENSE)
