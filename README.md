# 青空用例検索

青空文庫の全文（約17,000作品）から任意のワードを検索し、その用例・文脈を表示するサービスです。

## アーキテクチャ

```
frontend (React + Tailwind)
    ↓ /api/*
backend (Hono + TypeScript)
    ↓
SQLite FTS5 (trigramトークナイザー)
```

- **検索エンジン**: SQLite FTS5 + trigramトークナイザー
  - 外部サービス不要
  - 日本語の任意部分文字列マッチ対応
  - クエリ速度: 通常 < 10ms
- **バックエンド**: TypeScript + [Hono](https://hono.dev/) + better-sqlite3
- **フロントエンド**: React + Vite + Tailwind CSS
- **デプロイ**: Docker + docker-compose

## セットアップ

### 1. インデックス作成（初回のみ・20〜60分）

```bash
# データ格納ディレクトリ作成
mkdir -p data

# 全作品をインデックス
docker compose run --rm indexer

# テスト用: 最初の200作品だけ
docker compose run --rm indexer --limit 200

# 中断から再開
docker compose run --rm indexer --resume
```

### 2. サービス起動

```bash
docker compose up --build
```

ブラウザで http://localhost:8080 を開く。

## ローカル開発

```bash
# バックエンド
cd backend
npm install
DB_PATH=../data/aozora.db npm run dev

# フロントエンド（別ターミナル）
cd frontend
npm install
npm run dev
```

## 検索仕様

- 2文字以上のワードが対象
- SQLite FTS5 trigramによる完全部分一致検索
- 1クエリあたり最大50件取得、最大1000件まで表示
- 各結果は前後文脈（KWIC）付きで表示

## データソース

[青空文庫](https://www.aozora.gr.jp/) — 著作権の消滅した作品を公開するデジタル図書館。
インデックス作成時に aozora.gr.jp から直接ダウンロードします。
