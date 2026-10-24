# Implementation Handoff — Issue #7 / ルート標高解析

## Metadata

- Updated: 2026-10-25 JST
- Issue: https://github.com/jphacks/ng_2601/issues/7
- Branch: `norinori1/fe-3`
- Base: `6493512fa8197d974b593437661cbc69886ead12`（PR #25マージ済み）
- Status: 実装・ローカル検証完了、未コミット。PR作成・push・公開は未実施。
- Working Tree: 開始時からある未追跡`ltspice-mcp.toml`は変更していない。

## Changes / Design

正式な仕様・実装の入口は[ルート標高解析](../route-elevation.md)。依頼者が指定したPoC方式を用い、FEで国土地理院DEMの取得と推定計算を行う。検索APIや`Route`契約は変更していない。

- `features/elevation/`: DEM取得・RGB復号・補間、経路サンプリングと集計、単位整形、SVGグラフ、詳細・出典表示。
- `features/route/`: 解析状態を追加し、検索と独立して進捗・再試行・中断を管理。旧解析の結果・エラー・進捗は破棄する。
- 移植元は`norinori1/poc-maplibre`の`9efa773ef69588407361f0d19ea4b65bb67d26ae`。移植に伴い、不正な中間座標を飛ばして経路を繋がないこと、上り専用ルートの「最大下り」を正の値にしないことを修正・テストした。
- テストはVitest 4.1.12を追加。Vite 6に対応し、インストール時の`npm audit`は全依存について0件。新しいランタイム依存はない。

## Verification

環境: Windows、Node.js 24.15.0、Chrome headless / Playwright Python。日付はJST。単体テストとビルドは`frontend`で実施。

| 確認 | 結果 |
| --- | --- |
| `npm test` | 10ファイル・70テスト成功 |
| `npm run typecheck` | 成功 |
| `npm run build` | 成功。500kB超のチャンク警告あり（MapLibreを含むバンドル） |
| `npm audit --omit=dev` | 脆弱性0件 |
| `git diff --check`（ルート） | 成功 |
| Chrome・Vite dev・実際のシェル | 地図で出発／目的地指定→検索→起伏プロファイル表示。条件変更時の旧結果維持・注意表示、再検索で更新・注意解除を確認 |
| 375px × 812px | 横はみ出しなし。グラフ・軸・凡例をスクロールして表示できることと、PC／スマホの実画像を確認 |
| 同じ描画・状態管理でのモック | 平坦の0.0m／0%、中央欠測でSVGの線が2区間に分割、全欠測で数値不明・グラフなし、通信失敗→標高解析だけ再試行成功 |
| 解析進捗中の操作 | 詳細の開閉状態・キーボードフォーカス保持、左右矢印によるタブ移動、リセット後の古い進捗・完了の破棄を確認 |
| 実GSI DEM・Chrome | 約359.43mの確認用経路で19点取得。全点有効・エラー0、5mメッシュ使用。実画像の取得・RGB復号・標高補間を含む |

ブラウザ検証は8組の確認を通過し、未処理のページ例外は0件。全体シェルの検索フロー以外の欠測・失敗ケースは、同じ`RouteStore`・描画処理へテスト用データを渡して確認した。実GSIの確認は直接解析関数を呼ぶもので、実BEとの結合成功を意味しない。

ローカルの検証ハーネス・画像・JSONは`%TEMP%/ng2601-verify-elevation.py`と`%TEMP%/ng2601-elevation-evidence/`に保存した。これらはリポジトリには含めていない。再現手順・モックのURL一覧は[開発・確認](../route-elevation.md#開発確認)を参照。

## Limitations / Next Actions

1. 差分レビュー後、必要に応じてコミット・PR作成を行う。
2. 実BE（BRouter含む）との結合、公開環境、実機モバイル、Safari／Firefox、スクリーンリーダー、正解標高との精度比較は未検証。
3. DEMは地表面の推定値で、道路の瞬間勾配ではない。部分欠測では有効区間のみの集計と明示する。
4. 勾配色分け（#8）と地図・グラフ連動（#9）は別Issue。今回の完了と混同しない。
