# Implementation Handoff — FE-02 地図中心の画面シェル

## Metadata

- Updated: 2026-10-24
- Issue: [#4](https://github.com/jphacks/ng_2601/issues/4) / FE-02
- PR: 作成後に追記
- Branch: `norinori1/issue-4-map-shell`
- Base / Saved Commit: mainの`3c29233`を基準。保存済みコミットは関連PRのheadを参照
- Working Tree: 開始時クリーン。この変更のコード・テスト・文書・検証画像だけを保存
- Status: 実装・検証済み、PR作成待ち（マージ済みを意味しない）
- Author / Agent: Codex

## Objective

Issue本文に加え、追記の[Map First仕様](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380582784)・[モック](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380585729)に従い、常設ヘッダー・常設パネルを置かない共通骨格を実装する。

## Changes / Files

- [shell/render.ts](../../frontend/src/features/shell/render.ts)、[shell.css](../../frontend/src/features/shell/shell.css): 全面の地図領域、検索ランチャー、メニュー、PCサイドパネル、スマホの2段階ボトムシート、機能切替、フォーカス・safe-area・viewport対応。
- [state.ts](../../frontend/src/ui/state.ts): ロード中・空・エラーと任意の再試行ボタン。
- [main.ts](../../frontend/src/main.ts): 通常はシェル、開発時の`/dev/overview`だけFE-01のAPI一覧画面。
- [ブラウザテスト](../../frontend/tests/shell.test.ts): 地図接続口・表示状態・ライフサイクル等の15チェック。
- [frontend/README](../../frontend/README.md): シェルの接続口・再現手順・アイコン使用記録。API型／client・lockfile・ルートREADMEは未変更。
- [architecture](../architecture.md)、[api-contract](../api-contract.md): FE-01／文書基盤のマージ済み状態とFE-02の境界を反映。

## Design Decisions

初期パネル非表示はIssue追記仕様による。768pxを境にPC／スマホの同じパネルDOMを切り替え、地図DOMは作り直さない。地図・GPS・API・検索実行は各Issueに残し、未接続の地図操作は無効にする。接続口の正本は[frontend/README](../../frontend/README.md#後続機能との接続)。

### 使用した外部アイコン

**Bootstrap Icons v1.13.1 / MIT**を使用した。

- 配布元: [公式サイト](https://icons.getbootstrap.com/)、[固定バージョンの公式SVG](https://github.com/twbs/icons/tree/v1.13.1/icons)
- 保存先: `frontend/src/assets/icons/`。必要な19個のSVGを無改変で同梱し、[元のLICENSE](../../frontend/src/assets/icons/LICENSE)を保持。
- 使用箇所: メニュー、検索、レイヤー、方角、現在地、ズーム、パネル開閉・高さ切替、設定、道路情報、口コミ、写真スポット、ヘルプ、アプリ情報、ロード中・空・エラー表示。
- 実装: [icon.ts](../../frontend/src/ui/icon.ts)からCSS maskで参照。機能ごとの色はCSSで設定。読み上げ名はボタン／テキストが担当し、装飾アイコンは`aria-hidden`。
- 配布物: アプリ情報の「ライセンス全文」に原文を組み込み、本番ビルドにも著作権表示・許諾条件を保持。
- 選定理由: モックのシンプルな線画・塗りアイコンに近い。追加npm依存やCDN通信を避けるためSVGだけを採用。代替のアイコンパッケージ導入や手描きアイコンは不要と判断した。

## Verification

- 実行場所: `frontend/`。`npm ci --no-audit --no-fund`、`npm run typecheck`、`npm run build`成功。
- 起動: `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`。
- Edgeで`/tests/shell.html`を開き、**PASS (15)**を確認。地図DOM・帰属の保持、4操作のハンドラ、レイヤー通知／選択保持、入力保持、フォーカス復帰、共通状態のARIA／再試行、Tab循環、モーダル・シェル破棄。
- 手動ブラウザ確認: PC 1272×668／1162×858、スマホ375×812／375×706、横向き812×375、キーボード相当375×360。横はみ出しなし、PC／スマホの開閉とビュー切替、シート高さ切替、入力欄へスクロール、Esc／Enter／Tab、地図領域へのヒット、レイヤー選択保持を確認。ヘルプ／アプリ情報の導線とアイコン表記も確認。
- コンソール: 最終確認でerror／warnなし。画像とモック比較・変更履歴は[design-qa](../../design-qa.md)を参照。
- 本番ビルド: `npm run preview -- --host 127.0.0.1 --port 4174 --strictPort`で起動し、Edgeでアイコン、検索／メニューの切替、アプリ情報のライセンス原文表示を確認。
- 発見・修正: メニュー先頭のShift+Tabがブラウザ側へ抜ける挙動を明示的な循環処理で修正。展開シートと上部メニューの重なりを解消し、375×812で12pxの間隔を確認。
- 検証中の中断: HMRで画面が初期化された後の古いセレクタ操作と、ブラウザ接続切断で一度ずつ失敗。現在画面の取得／新しい検証タブで復旧し再確認した。画像正規化はPillowが未導入だったためWindowsのSystem.Drawingを使用した。
- リポジトリルート: `git diff --check`成功。Python標準ライブラリで更新した5文書の46相対リンクの存在を確認。`git diff --exit-code HEAD -- README.md frontend/package.json frontend/package-lock.json frontend/src/api frontend/src/types`で変更なしを確認。
- 未実施: iOS／Android実機のノッチ・仮想キーボード、Safari、スクリーンリーダー読み上げ、WebGL／MapLibre・実タイル・GPS・BE結合。viewport検証を実機確認とは扱わない。

## Known Limitations

- 地図画像・地図上のピン・検索結果・情報詳細は未実装。初期画面には準備中表示を出す。写真スポットは表示選択の骨格だけで、データ仕様は未決定。
- 検索入力とレイヤー選択の保持はページ内だけ。永続化やPreferences保存はしない。
- パネル外の地図領域は操作可能だが、実際のパン・ズームと帰属文字のサイズ／重なりは#5接続時に確認する。
- APIの未合意事項は[api-contract](../api-contract.md)に残す。このPRでBE接続済み・安全なルート案内が完成したとは扱わない。

## Next Actions

1. レビュー担当は`frontend/`で`npm ci`・`npm run dev`を実行し、`/`と`/tests/shell.html`を確認する。
2. #5担当は[接続口](../../frontend/README.md#後続機能との接続)を読み、`mapHost`へ地図、`attribution`へ帰属、対応する`mapActions`／レイヤー通知を接続する。地図本体の破棄・resizeと実操作を検証する。
3. #6・#10・#11・#12担当は`setViewContent`へ機能画面／共通状態を渡す。APIの未合意事項は各Issueで調整する。
4. #14は現在地操作、#15は実機safe-area・キーボード・地図結合を確認する。

## References

[Issue #4](https://github.com/jphacks/ng_2601/issues/4)、[FE Epic #2](https://github.com/jphacks/ng_2601/issues/2)、[マージ済みFE-01 #16](https://github.com/jphacks/ng_2601/pull/16)、[過去の文書基盤Handoff](2026-10-24-ai-collaboration-foundation.md)。
