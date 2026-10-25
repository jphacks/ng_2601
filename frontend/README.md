# frontend

Vite + TypeScript（UIライブラリなし）。画面は `src/api` の `ApiClient` インターフェースだけに依存し、モックと実APIを切り替えられる。

## セットアップ・起動・ビルド
```bash
npm install
npm run dev        # 開発サーバー（既定はモック）
npm run typecheck  # 型チェック
npm test           # 単体テスト（vitest。鮮度判定・フィルタ・取得制御、DEM・標高解析・状態管理）
npm run build      # 型チェック + 本番ビルド
```

## モック／実APIの切り替え
`.env.example` を `.env.local` にコピーして設定する。
* `VITE_API_MODE=mock`（既定）: `src/mocks/data.ts`・`src/mocks/mapData.ts`（道路・危険情報。日時は実行時刻からの相対）のサンプルデータを返す。バックエンド不要。実際の道路状況ではない。
* `VITE_API_MODE=http`: `VITE_API_BASE_URL` のバックエンドを呼ぶ（`src/api/http.ts`）。経路検索は `POST /v1/routes`、道路・危険情報は `GET /v1/map-data`。

### ローカルのバックエンドにつなぐ
```bash
# リポジトリ直下で（初回のみ）
git submodule update --init --recursive   # BRouter。未初期化だと setup.sh が止まる

# back/ で
./scripts/setup.sh           # 初回のみ。backend/.env の作成と日本全域の RD5 ダウンロード（約500MB）
# backend/.env の SESSION_SECRET を32文字以上のランダムな値に置き換える（下記）
./scripts/launch.sh          # http://localhost:8080
./scripts/db/seed_dev.sh     # 開発用のユーザー報告（名古屋駅付近に2件）

# frontend/ で
VITE_API_MODE=http npm run dev
```
* Windows の cmd・PowerShell では `VITE_API_MODE=http npm run dev` の書き方が使えない。`.env.local` に `VITE_API_MODE=http` を書いて `npm run dev` で起動する（どの OS でも同じ）。
* 以前に `.env.example` を `.env.local` へコピーした人は、`VITE_API_BASE_URL=http://localhost:8000` が残っている。バックエンドは 8080 で起動するので、`http://localhost:8080` に直すかその行を消す。
* `backend/.env.example` の `SESSION_SECRET` は26文字の仮の値で、バックエンドは32文字未満だと起動しない（`launch.sh` のヘルスチェックが失敗する）。`openssl rand -hex 32` などで作った値に置き換える。
* バックエンドの CORS は `FRONTEND_ORIGIN`（既定 `http://localhost:5173`）だけを許可する。Vite が別のポートで起動したら、`back/backend/.env` に `CORS_ALLOW_ORIGINS=http://localhost:5173,http://localhost:5174` のように並べて書き、`launch.sh` で起動し直す。
* 地図の初期表示は名古屋駅付近。シードもモックのデータもこの範囲にある。
* 経路検索には BRouter と RD5 データが要る。無いときは 503 になり、「ルート探索サービスを利用できません」と表示される。

モックの経路検索は、URLに `?mock=empty|error|timeout|slow` を付けると0件・通信エラー・タイムアウト・遅延を再現できる。
口コミの投稿は `?mock=post-error|post-auth|post-slow` で失敗・要ログイン・遅延を再現できる（投稿した口コミは再読み込みまで一覧に残る）。

標高解析は `?elevation=flat|hill|partial|missing|slow|error` で平坦・起伏・部分欠測・全欠測・遅延・通信失敗を再現できる（`mock` と併用可能）。モックでは外部DEMへ通信しない。HTTPモードでは検索成功後に国土地理院の標高タイルをブラウザから取得する。計算規則・出典・欠測表示は[ルート標高解析](docs/route-elevation.md)を参照。

テストにはmainと同じ開発用依存のVitest 2を使用する。標高解析による新規ランタイム依存はない。

## ディレクトリ構成
* `src/types/api.ts` … 暫定API型（経路・標高プロファイル・Preferences・危険情報・口コミ・共通エラー）。`@provisional` は本番API確定後に差し替える。
* `src/api/` … `client.ts`（インターフェース）、`mock.ts`、`http.ts`、`errors.ts`（共通 `ApiError`）
* `src/mocks/` … モックデータ
* `src/features/` … 機能ごとの画面。`hazards/` は道路・危険情報（`normalize` / `freshness` / `filter` は DOM 非依存でテスト対象）
* `src/ui/` … 共通UI部品
