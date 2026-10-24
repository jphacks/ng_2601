# アーキテクチャと実装状態

## 確認時点と根拠

2026-10-24確認。mainの基準は[c5e8aec](https://github.com/jphacks/ng_2601/tree/c5e8aec728c92abbb6792770eb057dd44e21a423)で、追跡ファイルはREADME.mdとLICENSEのみです。この文書基盤の変更はプロダクトの機能を追加しません。

- [Issue #2（FE Epic）](https://github.com/jphacks/ng_2601/issues/2)と子Issue #3〜#15はすべてOPENでした。要件の記載は、実装完了やBEとの合意を意味しません。
- [FE-01 / Issue #3](https://github.com/jphacks/ng_2601/issues/3)の[PR #16](https://github.com/jphacks/ng_2601/pull/16)はマージ済みです。以下の「PR #16内」の記述は、確認したhead [b9de6e2](https://github.com/jphacks/ng_2601/tree/b9de6e2bc07f173f00ae6cb8491bf348974578ea)の内容で、現在は`frontend/src/api/`等に取り込まれています。
- [FE-03 / Issue #5](https://github.com/jphacks/ng_2601/issues/5)の[PR #22](https://github.com/jphacks/ng_2601/pull/22)はマージ済み（取り込み後のHEADは`abe740b`）。地図表示の実装は[`frontend/src/features/map/`](../frontend/src/features/map)です。
- [FE-09 / Issue #11](https://github.com/jphacks/ng_2601/issues/11)は、ブランチ`norinori1/fe-hazards`で実装中です（PR未作成・未マージ。マージまで採用済みとして扱わない）。
- [Issue #1](https://github.com/jphacks/ng_2601/issues/1)が示す技術検証用リポジトリは参考資料です。そこにある機能を本リポジトリの実装済み機能として扱いません。

状態が変わるPRでは、この確認時点と影響する節を更新してください。最新の担当・進捗はGitHubで再確認します。

## 構成と責務

| 領域 | 確認できた方針・責務 | 実装状態・根拠 |
| --- | --- | --- |
| フロントエンド | 地点・設定入力、地図と検索結果・標高・危険情報・口コミの表示、読み込み／空／失敗状態を扱う | mainに実装なし。[Epic #2](https://github.com/jphacks/ng_2601/issues/2)の要件 |
| FE開発・通信基盤 | Vite + TypeScript、UIライブラリなし。画面はApiClient経由でモック／HTTPを切り替える | PR #16内の提案。`frontend/src/features/`、`frontend/src/ui/`、`frontend/src/api/`、`frontend/src/types/`、`frontend/src/mocks/`に分離。mainには未導入 |
| バックエンド | FEから経路探索を依頼し、Preferencesを取得・保存する連携を想定 | [#6](https://github.com/jphacks/ng_2601/issues/6)、[#10](https://github.com/jphacks/ng_2601/issues/10)の要件。mainおよび確認したPRにBE実装なし。言語・フレームワーク・DB・デプロイ構成は未確認／未決定 |
| 地図表示 | MapLibreで地点選択、ルート・危険情報・口コミのレイヤー表示、帰属表示 | [#5](https://github.com/jphacks/ng_2601/issues/5)で`frontend/src/features/map/`に実装（PR未マージ）。ベースマップは国土地理院の淡色地図ラスタ（`style.ts`）、帰属は「地理院タイル」を常時表示。ルート・口コミはモックを重ねており、API接続は#6・#12。道路・危険情報は#11でMapLibreのGeoJSONレイヤーとして描画（下の行）。標高・勾配は#7〜#9 |
| 経路探索 | FEは出発地・目的地・設定を送り、返却された経路を描画する | [#6](https://github.com/jphacks/ng_2601/issues/6)の計画。探索エンジン、道路グラフ、計算・保存基盤は未決定。PR #16はモックと暫定HTTP clientのみ |
| 標高・勾配 | 距離・獲得標高・下降量・標高プロファイルの表示と勾配色分け | [#7](https://github.com/jphacks/ng_2601/issues/7)、[#8](https://github.com/jphacks/ng_2601/issues/8)の計画。データ提供元、計算をFE／BEのどちらが担うか、欠測表現・勾配閾値は未合意 |
| 道路・危険情報 | レイヤー・フィルタ・詳細で種類、情報源、更新日時、有効期限を表示 | [#11](https://github.com/jphacks/ng_2601/issues/11)で`frontend/src/features/hazards/`に実装中（ブランチ`norinori1/fe-hazards`、未マージ）。取得は`api/mapDataLoader.ts`が表示領域（bbox）ごとに`getMapData`を呼ぶ。応答はBE担当共有のスニペット`GET /v1/map-data`（公的規制・事故履歴・交通量・ユーザー報告を別々のGeoJSONで返す）の形に合わせたが、このエンドポイントはリポジトリ未確認で、実サーバーとの接続は未検証。FEで4分類（危険／便利／地形／道路設備）と情報区分（公的規制／統計／ユーザー報告）に正規化し、更新日時の不明・欠測、期限切れ、解消済み、未確認を区別して表示する。収集・配信元と保存方式は未決定 |
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

PR #16内では、画面 → `ApiClient` → `createMockClient`または`createHttpClient`という境界があります。[API client](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/client.ts)と[切り替え実装](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/index.ts)が根拠です。HTTP clientの存在は、対応するBE APIの稼働・実装を意味しません。

FEは表示と利用者操作、BEは合意したAPIの提供を境界として調整します。ただし標高計算の配置や実データの取得責務などは未確定です。[API契約の未合意点](api-contract.md)を先に解決してください。モック結果を実測値・安全性の保証として扱いません。

## 次に確認すること

- FE-01は[#3 / PR #16](https://github.com/jphacks/ng_2601/pull/16)の差分・レビュー・マージ状態を確認して取り込む。main上に同じ基盤を別途作らない。
- FEとBEの接続前に、[api-contract.md](api-contract.md)に挙げた差分と未決定事項を関係Issueで合意する。
- 機能の受入条件は各Issueを使う。結合・モバイル・通信失敗・欠測の検証は[#15](https://github.com/jphacks/ng_2601/issues/15)で集約する。
- 将来構想（リアルタイムナビ、推薦等）はEpic #2で区別されており、現状の構成には含めない。
