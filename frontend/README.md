# frontend

Vite + TypeScript（UIライブラリなし）。画面は `src/api` の `ApiClient` インターフェースだけに依存し、モックと実APIを切り替えられる。

## セットアップ・起動・ビルド
```bash
npm install
npm run dev        # 開発サーバー（既定はモック）
npm run typecheck  # 型チェック
npm test           # 単体テスト（vitest。鮮度判定・フィルタ・取得制御などの純ロジック）
npm run build      # 型チェック + 本番ビルド
```

## モック／実APIの切り替え
`.env.example` を `.env.local` にコピーして設定する。
* `VITE_API_MODE=mock`（既定）: `src/mocks/data.ts`・`src/mocks/mapData.ts`（道路・危険情報。日時は実行時刻からの相対）のサンプルデータを返す。バックエンド不要。実際の道路状況ではない。
* `VITE_API_MODE=http`: `VITE_API_BASE_URL` のバックエンドを呼ぶ（`src/api/http.ts`）。経路検索は `POST /v1/routes`、道路・危険情報は `GET /v1/map-data`。

モックの経路検索は、URLに `?mock=empty|error|timeout|slow` を付けると0件・通信エラー・タイムアウト・遅延を再現できる。

## ディレクトリ構成
* `src/types/api.ts` … 暫定API型（経路・標高プロファイル・Preferences・危険情報・口コミ・共通エラー）。`@provisional` は本番API確定後に差し替える。
* `src/api/` … `client.ts`（インターフェース）、`mock.ts`、`http.ts`、`errors.ts`（共通 `ApiError`）
* `src/mocks/` … モックデータ
* `src/features/` … 機能ごとの画面。`hazards/` は道路・危険情報（`normalize` / `freshness` / `filter` は DOM 非依存でテスト対象）
* `src/ui/` … 共通UI部品
