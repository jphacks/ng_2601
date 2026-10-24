# frontend

Vite + TypeScript（UIライブラリなし）。画面は `src/api` の `ApiClient` インターフェースだけに依存し、モックと実APIを切り替えられる。

## セットアップ・起動・ビルド
```bash
npm install
npm run dev        # 開発サーバー（既定はモック）
npm run typecheck  # 型チェック
npm run build      # 型チェック + 本番ビルド
```

## モック／実APIの切り替え
`.env.example` を `.env.local` にコピーして設定する。
* `VITE_API_MODE=mock`（既定）: `src/mocks/data.ts` のサンプルデータを返す。バックエンド不要。
* `VITE_API_MODE=http`: `VITE_API_BASE_URL` のバックエンドを呼ぶ（`src/api/http.ts`）。

## ディレクトリ構成
* `src/types/api.ts` … 暫定API型（経路・標高プロファイル・Preferences・危険情報・口コミ・共通エラー）。`@provisional` は本番API確定後に差し替える。
* `src/api/` … `client.ts`（インターフェース）、`mock.ts`、`http.ts`、`errors.ts`（共通 `ApiError`）
* `src/mocks/` … モックデータ
* `src/features/` … 機能ごとの画面
* `src/ui/` … 共通UI部品

## FE-02 画面シェル

通常の `/` は[Issue #4の追記仕様](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380582784)・画像モックに沿った画面骨格。初期状態は全面の地図領域とフローティングUIだけで、固定ヘッダー・常設パネルはない。

- 下部の既存「どこへ行く？」から検索を開くと、同じバーが上部全幅へ移動する。バーはパネル外に置き、768px以上は直下の左パネル、それ未満は画面幅に合う縦パネル（通常は高さ65%、表示領域が低い場合は上限を優先）。閉じると下部へ戻る。他のスマホ向けビューは従来のボトムシートを使う。
- メニューから設定・道路情報・口コミ・ヘルプ・アプリ情報へ移動する。Esc／閉じるでフォーカスを起点へ戻す。メニュー内はTab／Shift+Tabが循環する。
- `viewport-fit=cover`、safe-area、`visualViewport`のresize／scrollで回転・仮想キーボードによる表示領域の変化を扱う。帰属表示用に最低24px＋safe-areaを空け、折り返し時はResizeObserverで実際の高さ＋余白を確保する。帰属欄は最大64px（低い画面では20%）まで表示し、超過分はキーボードでもスクロールできる。
- 地図・検索・設定保存・GPS・情報取得は別Issueのため未接続。地図領域は準備中表示、未接続の地図操作は無効。入力とレイヤー選択は画面を閉じても保持するが、リロード時には保存しない。
- FE-01の一覧画面は開発サーバーの `/dev/overview` で確認できる。通常画面ではAPIを呼ばない。

検索バーは`renderShell`内で一度生成した`searchButton`を使い続け、CSSで位置だけを切り替える。複製・再生成・PC／スマホ別実装はない。既存の`routeForm`と入力DOMは`contents`に保持し、開閉・タブ切替で入力値と折りたたみ状態を維持する。経路設定は既存の設定ボタンを`details`内に移しただけで、設定機能を作り直していない。

上下移動は230msで、`prefers-reduced-motion`では無効。viewport変更時は移動をキャンセルし、フォーカス中の入力を内部スクロールで表示領域内へ戻す。検索候補・検索実行・設定保存は元々未接続で、今回も新設しない。

### 後続機能との接続

`src/features/shell/render.ts`の`renderShell(root, options)`を使用する。API型・clientの複製は作らない。

| 接続口 | 用途・所有者 |
| --- | --- |
| `mapHost` / `options.mapContent` | #5が地図をマウントする領域。ビュー開閉・切替でもDOMを維持。地図本体の初期化・resize・破棄は#5が担当 |
| `attribution` | #5が地図提供元の帰属を挿入する常設領域。実際の文字量・MapLibre標準UIとの重なりは接続時に再確認 |
| `options.mapActions` | `north` / `locate` / `zoomIn` / `zoomOut`。接続したボタンだけ有効。現在地は#14が担当 |
| `options.onLayerChange` | `hazards` / `reviews` / `photos`と表示可否を通知。レイヤー描画・写真データ仕様は未実装 |
| `openView` / `closePanel` | 各機能の表示・終了。`openView`の任意の第2引数で、閉じたときのフォーカス復帰先を指定 |
| `setViewContent(view, element)` | 機能担当が検索結果・詳細・設定・状態表示を差し込む。スクロールはシェルが担当 |
| `destroy()` | シェルとモーダルを削除し、viewportのイベントリスナーと帰属欄のResizeObserverを解除。地図本体は呼び出し側で破棄 |

ロード中・空・エラーは`src/ui/state.ts`の`renderState`を使う。取得と再試行の処理は呼び出し側が所有し、`retry`へ渡す。

### ブラウザテスト

`npm run dev`後、`/tests/shell.html`を開く。現在は`PASS (34)`。初期15件、レビュー回帰11件、検索UI統合8件を確認する。統合テストではバー・入力DOMの同一性、上部全幅／レスポンシブ配置、一重表示、既存ハンドラ、入力・折りたたみ状態、下部への復帰を確認する。テストファイルも`npm run typecheck`の対象。本番ビルドには含めない。Lintスクリプトは未導入。

レイアウトはPC、375px縦向き、横向き、キーボード相当の低いviewportで別途確認する。検証記録と実機未検証事項は[Handoff](../docs/handoffs/2026-10-24-issue-4-map-shell.md)を参照。

### 継続使用するテーマ

今後のUIとMapLibreの共通パレットは **Nature Ride**。[`src/styles/tokens.css`](src/styles/tokens.css)へ色値と意味別トークンを一元定義し、`shell.css`から読み込む。各コンポーネントへ色値を複製しない。使い分け・地図側からの読み取り・コントラストは[共通テーマの案内](../docs/design-system.md)を参照。勾配別の色分け・閾値は別Issue。

### 使用アイコン

[Bootstrap Icons](https://icons.getbootstrap.com/) **v1.13.1 / MIT**。メニュー、検索、レイヤー、方角、現在地、ズーム、閉じる、高さ切替、各ビュー、情報カテゴリ、状態表示に使用。

必要な19個のSVGを[公式配布元](https://github.com/twbs/icons/tree/v1.13.1/icons)から`src/assets/icons/`へ無改変で同梱し、[LICENSE](src/assets/icons/LICENSE)を保持する。`src/ui/icon.ts`でCSS maskとして参照し、色だけを用途に合わせる。npm依存とlockfileは変更せず、アイコン表示時にCDNへ通信しない。手描きSVGや絵文字による代用は行っていない。

アプリ情報の「ライセンス全文」にも原文を組み込み、本番ビルドにも著作権表示・許諾条件を保持する。
