# FE-02 画面シェルのデザインQA

対象は[Issue #4](https://github.com/jphacks/ng_2601/issues/4)の画面骨格・ナビゲーション。地図・ピン・GPS・検索実行・API接続は関連Issueの担当範囲であり、この判定には含めない。モック全体の機能完成を意味しない。

初期実装（`51df251`まで）のモック比較を以下に保持する。現在の配色は依頼者指定のNature Rideへ更新しており、最新の検証は末尾の追記を参照。

## 比較対象と証跡

- Source visual truth: [Issueの画像モック](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380585729)。元画像1671×941。PC領域`(22,58,1162,858)`、スマホのOS表示を除いた領域`(1216,96,435,819)`を使用。
- 正規化した参照: [PC](docs/verification/issue-4/reference-desktop.jpg)は1162×858、[スマホ](docs/verification/issue-4/reference-mobile.jpg)は375×706（幅375へ縮小）。OS・端末枠はアプリとして再実装しない。
- 実装URL: 開発サーバーの`/`。Edgeで実際に描画して取得した[PC初期](docs/verification/issue-4/desktop-initial.jpg)は1162×858、[スマホ初期](docs/verification/issue-4/mobile-initial.jpg)は375×706。保存画像とCSS viewportをそろえて比較。画面自体のDPRによる追加の拡大比較は行わない。
- State: 初期状態（検索・設定パネルなし）。[PCの同寸比較](docs/verification/issue-4/comparison-desktop.jpg)と[スマホの同寸比較](docs/verification/issue-4/comparison-mobile.jpg)は左が参照・右が実装。一つの画像に並べて全体を確認した。
- 操作状態: [PCパネル](docs/verification/issue-4/desktop-panel.jpg)、[スマホ半開](docs/verification/issue-4/mobile-sheet.jpg)、[スマホ展開](docs/verification/issue-4/mobile-expanded.jpg)、[横向き](docs/verification/issue-4/landscape.jpg)、[低い画面での入力](docs/verification/issue-4/keyboard-height.jpg)。パネルの見た目はモックにないため、Issue本文の操作要件で確認した。

## Findings / 比較履歴

1. メニューで先頭からShift+Tabを押すとブラウザ側へフォーカスが抜けるP2を発見。明示的な先頭／末尾の循環処理を追加し、実操作とブラウザテストの両方で修正を確認。
2. スマホ展開シートが上部メニューと重なるP2を発見。高さ上限を変更。375×812でメニュー下端68px・シート上端80px、12pxの間隔を確認。[修正後](docs/verification/issue-4/mobile-expanded.jpg)。
3. 初回比較後、PCの円形操作ボタンを64px、検索バーを70pxへ調整。[最終PC比較](docs/verification/issue-4/comparison-desktop.jpg)で全幅検索・左上メニューの比率を再確認。
4. 最終比較: 対象範囲に未修正のP0／P1／P2なし。準備中の地図、無効な未接続操作、追記仕様で追加された現在地／ズームボタンは意図的な差分。

## 必須の比較面

| 面 | 確認結果 |
| --- | --- |
| フォント・文字 | 日本語サンセリフのシステムフォントを使用。検索文言・太さ・折り返しを確認。モックのフォント名は指定されておらず完全一致とは扱わない。外部フォント取得なし |
| 余白・構成 | 地図全面、常設ヘッダー／パネルなし、左上メニュー、右操作群、下部カプセル検索。PC64pxボタン／70px検索、375pxでは52px／60px。帰属用24px＋safe-areaの下余白は接続に備えた差分 |
| 色・トークン | 白い検索、半透明の補助ボタン、薄い影、紺の文字、青い方角。レイヤー一覧は警告／吹き出し／カメラの形状と橙／緑／青を併用 |
| 画像・アイコン | ユーザー提供モックを参照。地図画像を背景として流用せず、地図接続までは明示的な準備中表示。Bootstrap Icons v1.13.1のSVGを無改変で同梱。手描きアイコン・架空の地理情報なし |
| 文言・内容 | 「どこへ行く？」、設定・道路情報・口コミの導線が一致。未接続機能には準備中を明示。API結果や情報件数を装わない |

フォーカス領域の比較は、PC／スマホ同寸比較の左上メニュー、右ボタン群、下部検索を拡大表示して実施。これらは文字・アイコンが読める解像度であり、別の切り抜き画像は不要だった。

## 操作・検証と残り

- 検索開閉、PCサイドパネル、スマホ高さ切替、内容スクロール、各ビュー・メニュー・ヘルプ・アプリ情報、入力／選択保持、Enter／Esc／Tab・Shift+Tab、フォーカス復帰を確認。
- 1272×668、1162×858、375×812、375×706、812×375、375×360で確認。DOM計測で横はみ出しなし、パネル外は地図領域がヒットする。低い画面で目的地入力にフォーカスし、内部スクロールで入力欄が見える。
- `/tests/shell.html`: [PASS (15)](docs/verification/issue-4/browser-tests.jpg)。最終確認でブラウザコンソールのerror／warnなし。
- 本番ビルドを`npm run preview`で起動し、検索・メニューと[ライセンス全文](docs/verification/issue-4/production-license.jpg)を確認。SVGとMIT原文が本番でも表示される。
- 実機のsafe-area／仮想キーボード、Safari、スクリーンリーダー、実地図の操作・帰属表示は未検証。#5／#15で実施する。

実装チェック: 対象範囲の修正と再撮影を完了。後続担当の接続口・ライセンス・残課題は[Handoff](docs/handoffs/2026-10-24-issue-4-map-shell.md)に記録した。

## Nature Ride追加の検証（2026-10-24）

- 新しい配色の基準は[依頼者指定を記録した共通テーマ](docs/design-system.md)と[CSSトークン](frontend/src/styles/tokens.css)。元モックの青系配色は今回の指定で置き換える。フォント、アイコン資産、文言、パネル構成・ブレークポイントは維持。
- 本番プレビューから取得: [PC初期](docs/verification/issue-4/nature-ride/desktop-initial.jpg)、[PCパネル](docs/verification/issue-4/nature-ride/desktop-panel.jpg)は1162×858。[スマホパネル](docs/verification/issue-4/nature-ride/mobile-panel.jpg)・[展開](docs/verification/issue-4/nature-ride/mobile-expanded.jpg)は375×812。[レイヤー](docs/verification/issue-4/nature-ride/layers.jpg)も確認。
- [主要5領域の変更前後計測](docs/verification/issue-4/nature-ride/layout.json): PC／375pxのヘッダー、検索バー、操作群、パネル、内容領域の矩形が一致。見出しと入力欄のフォーカス輪郭はNature Rideの緑で明示する。
- [実表示色の測定](docs/verification/issue-4/nature-ride/contrast.json): 文字・補助文字・選択状態・フォーカス・入力枠・警告・将来ルート色の11組が基準以上。砂色を白背景上の小さな文字に使わず、濃色文字と選択背景を組み合わせる。
- CodeRabbitの3件を修正。内容置換で消えたフォーカスは見出しへ戻し、パネル外や非表示ビュー更新のフォーカスは維持。見出しに可視輪郭を付け、スマホ・低い画面でも接続済みズームを表示する。これに伴う低い画面の操作群の横並びは意図的な修正。
- 初回レビューへの回帰6件はズーム可視性2件、見出し可視性1件、置換時のフォーカス3件。さらに[帰属表示の追加指摘](https://github.com/jphacks/ng_2601/pull/19#discussion_r4366445479)に対応し、実際の高さを観測して下部の余白を確保する。長文の折り返し・上限超過時のスクロール・キーボードフォーカス、操作群／パネルとの非重複、空への復帰の5件を追加。
- [最新のブラウザテスト結果](docs/verification/issue-4/nature-ride/browser-tests.json): 1162×858、375×812、375×360、812×375で各**PASS (26)**。帰属欄が空の通常画面では元の余白を維持。コンソールerror／warnなし。
- 未検証: 実機safe-area／キーボード、Safari、スクリーンリーダー、実地図上のルート・警告。地図・勾配色・閾値の追加なし。

final result: passed
