# アーキテクチャと実装状態

## 確認時点と根拠

2026-10-24確認。今回の作業基準はmainの[3c29233](https://github.com/jphacks/ng_2601/tree/3c29233)です。[PR #16](https://github.com/jphacks/ng_2601/pull/16)（FE-01）と[PR #17](https://github.com/jphacks/ng_2601/pull/17)（文書基盤）はマージ済みです。

- FE-02 / [Issue #4](https://github.com/jphacks/ng_2601/issues/4)の画面シェルは今回の変更です。採用する見た目はIssue追記の[仕様](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380582784)と[モック](https://github.com/jphacks/ng_2601/issues/4#issuecomment-6380585729)。マージ状態は関連PRで確認してください。
- [PR #18](https://github.com/jphacks/ng_2601/pull/18)（BE）はOPEN・未マージのため、ここでは採用済み構成として扱いません。
- [Issue #1](https://github.com/jphacks/ng_2601/issues/1)が示す技術検証用リポジトリは参考資料です。そこにある機能を本リポジトリの実装済み機能として扱いません。

状態が変わるPRでは、この確認時点と影響する節を更新してください。最新の担当・進捗はGitHubで再確認します。

## 構成と責務

| 領域 | 確認できた方針・責務 | 実装状態・根拠 |
| --- | --- | --- |
| フロントエンド | 地点・設定入力、地図と検索結果・標高・危険情報・口コミの表示 | [Epic #2](https://github.com/jphacks/ng_2601/issues/2)の計画。FE-01の一覧画面はマージ済み。実際の地図・検索・各機能は別Issue |
| FE開発・通信基盤 | Vite + TypeScript、UIライブラリなし。ApiClient経由でモック／HTTPを切り替える | PR #16で導入済み。`frontend/src/features/`、`frontend/src/ui/`、`frontend/src/api/`、`frontend/src/types/`、`frontend/src/mocks/`に分離 |
| 画面シェル（FE-02） | 全面の地図マウント領域、フローティング検索・メニュー、PCサイドパネル／スマホボトムシート、共通表示状態 | 今回の変更。[shell/render.ts](../frontend/src/features/shell/render.ts)。初期状態はパネル非表示。地図・API接続なし。接続口と制約は[frontend/README](../frontend/README.md)を参照 |
| バックエンド | FEから経路探索を依頼し、Preferencesを取得・保存する連携を想定 | [#6](https://github.com/jphacks/ng_2601/issues/6)、[#10](https://github.com/jphacks/ng_2601/issues/10)の要件。基準mainにBE実装なし。PR #18は未マージで今回の検証対象外。BE構成・契約は接続担当が確認する |
| 地図表示 | MapLibreで地点選択、ルート・危険情報・口コミのレイヤー表示、帰属表示 | [#5](https://github.com/jphacks/ng_2601/issues/5)の計画。PR #16はデータ確認用一覧画面であり、地図基盤の実装ではない。地図スタイル・タイル提供元は未合意 |
| 経路探索 | FEは出発地・目的地・設定を送り、返却された経路を描画する | [#6](https://github.com/jphacks/ng_2601/issues/6)の計画。探索エンジン、道路グラフ、計算・保存基盤は未決定。PR #16はモックと暫定HTTP clientのみ |
| 標高・勾配 | 距離・獲得標高・下降量・標高プロファイルの表示と勾配色分け | [#7](https://github.com/jphacks/ng_2601/issues/7)、[#8](https://github.com/jphacks/ng_2601/issues/8)の計画。データ提供元、計算をFE／BEのどちらが担うか、欠測表現・勾配閾値は未合意 |
| 道路・危険情報 | レイヤー・フィルタ・詳細で種類、情報源、更新日時、有効期限を表示 | [#11](https://github.com/jphacks/ng_2601/issues/11)の計画。収集・配信元、保存方式は未決定。期限切れ／未確認／欠測を区別する要件がある |
| 口コミ | 地点に紐づく一覧・詳細・投稿、ユーザー情報と公的情報の区別 | [#12](https://github.com/jphacks/ng_2601/issues/12)、[#13](https://github.com/jphacks/ng_2601/issues/13)の計画。位置の持ち方、投稿API、認証・制限・モデレーションは未合意 |

## データフロー

以下はIssue上の予定フローです。mainで動作する通信経路ではありません。

```text
利用者の設定・出発地／目的地
  → FEの入力・表示処理
  → API通信境界
  → BEへの経路探索依頼（探索・データ源は未決定）
  → 返却された経路・解析データをFEで地図／グラフ表示

地図の表示領域・選択地点
  → 危険情報／口コミの取得
  → FEでレイヤー／詳細表示

口コミ投稿入力 → 入力検証 → 投稿API → 取得結果の再表示
```

FE-01では、画面 → `ApiClient` → `createMockClient`または`createHttpClient`という境界があります。[API client](../frontend/src/api/client.ts)と[切り替え実装](../frontend/src/api/index.ts)が根拠です。HTTP clientの存在は、対応するBE APIの稼働・実装を意味しません。FE-02の初期画面はAPIを呼ばず、各機能がシェルへ表示内容を渡す構成です。

FEは表示と利用者操作、BEは合意したAPIの提供を境界として調整します。ただし標高計算の配置や実データの取得責務などは未確定です。[API契約の未合意点](api-contract.md)を先に解決してください。モック結果を実測値・安全性の保証として扱いません。

## 次に確認すること

- FE-03 / [#5](https://github.com/jphacks/ng_2601/issues/5)ではFE-02の`mapHost`・`attribution`へ地図を接続する。シェルの開閉で地図を再作成しない。
- FEとBEの接続前に、[api-contract.md](api-contract.md)に挙げた差分と未決定事項を関係Issueで合意する。
- 機能の受入条件は各Issueを使う。結合・モバイル・通信失敗・欠測の検証は[#15](https://github.com/jphacks/ng_2601/issues/15)で集約する。
- 将来構想（リアルタイムナビ、推薦等）はEpic #2で区別されており、現状の構成には含めない。
