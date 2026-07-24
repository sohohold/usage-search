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
| `npm run index` | インデクサー実行（`scripts/build-index.ts`） |

## 検索仕様

- 3文字以上のワードが対象（trigramトークナイザーの制約上、2文字以下は検索不可）
- SQLite FTS5 trigramによる完全部分一致検索
- 1リクエストあたり既定20件（最大50件）取得。「もっと見る」でオフセットページングし、追加分をこれまでの結果に継続表示（表示件数の上限なし）
- 各結果はKWIC形式の前後文脈付きで表示。結果カードをクリックするとより広い範囲の文脈に展開表示
- 入力から400msデバウンスして自動検索。入力中に前のリクエストが残っていれば中断し、最新のクエリを優先
- 検索結果・統計情報はCDNで24時間キャッシュ（`stale-while-revalidate`で最大7日間）

## テスト / CI

GitHub Actions（`.github/workflows/ci.yml`）で以下を実行:

- 型チェック（`tsc --noEmit`）と本番ビルド
- E2Eスモークテスト: 50作品分のインデックスを実際に構築し、開発サーバーを起動して `/api/stats` と `/api/search` の応答、および2文字以下のクエリが400で拒否されることを確認

## データソース

[青空文庫](https://www.aozora.gr.jp/) — 著作権の消滅した作品を公開するデジタル図書館。
インデックス作成時は青空文庫のGitHubミラー（目録: aozorabunko/aozorabunko、本文: aozorahack/aozorabunko_text）からダウンロードします。

## ライセンス

[MIT](./LICENSE)
