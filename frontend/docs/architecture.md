# アーキテクチャと実装状態

## 確認時点と根拠

2026-10-25確認。mainの基準は[6493512](https://github.com/jphacks/ng_2601/commit/6493512fa8197d974b593437661cbc69886ead12)（PR #25のマージ）です。`frontend/`（FE-01〜FE-04）と`back/`（[PR #18](https://github.com/jphacks/ng_2601/pull/18)、マージ済み）が含まれます。

### 2026-10-25 / FE-07の更新

Issue #9はPR #35（#8）の積み上げブランチ`norinori1/fe-06-gradient-colors`（`4fa94a9`）を基準にする。標高プロファイル上の選択位置と地図上のルート位置・区間を双方向に連動させる。選択状態は[`features/elevation/selection.ts`](../src/features/elevation/selection.ts)と[`link.ts`](../src/features/elevation/link.ts)が持ち、経路に沿った距離でグラフ・地図・数値表示を対応付ける。地図側は#8の100m計測窓を帯で、選択位置を丸印で示す。`Route`型・API契約・依存関係は変更しない。グラフの `pointermove` はrAFで1フレーム1回にまとめ、地図のハイライト更新は窓が変わったときだけ行う。検索カードの箱が地図操作を妨げていたため、[`shell.css`](../src/features/shell/shell.css)でバー・パネルの外側を地図へ通す最小修正を入れた。詳細・確認結果は[地図とグラフの連動](route-elevation.md#地図とグラフの連動fe-07--issue-9)を参照。実DEMの連動・実BE・実機モバイルは未検証。

### 2026-10-25 / FE-05の更新

Issue #7の作業基準はmainの`6493512`（PR #25マージ済み）。このcheckoutにはFE基盤・画面シェル・MapLibre地図・単一ルート検索とBEが存在する。以下の2026-10-24時点の履歴より、該当機能ではこの更新と現行ソースを優先する。

標高表示は[`features/elevation/`](../src/features/elevation/)で実装。`RouteStore`は経路検索と標高解析を別状態で管理し、経路成功後にブラウザから国土地理院DEMを取得する。`ApiClient`経由の距離・時間と、DEMからFEで計算した推定標高を結果タブで表示する。解析中断は共有タイル通信を妨げず、古い応答は捨てる。モックモードでは合成標高を同じ解析処理に渡す。詳しい計算・出典・欠測規則は[ルート標高解析](route-elevation.md)、APIへの影響は[API契約](api-contract.md)を参照。FE-06積み上げブランチ`norinori1/fe-06-gradient-colors`で#8を実装中。#7のDEM由来100m窓を再利用し、Route API型は変更しない。#9の地図・グラフ連動は別Issueで未実装。


- [Issue #2（FE Epic）](https://github.com/jphacks/ng_2601/issues/2)はOPENです。子Issueは#3・#4・#5がCLOSED、#11を含む他はOPENでした。要件の記載は、実装完了やBEとの合意を意味しません。
- [FE-01 / Issue #3](https://github.com/jphacks/ng_2601/issues/3)の[PR #16](https://github.com/jphacks/ng_2601/pull/16)はマージ済みです。導入されたAPI基盤は`frontend/src/api/`等にあります（初回確認のhead: [b9de6e2](https://github.com/jphacks/ng_2601/tree/b9de6e2bc07f173f00ae6cb8491bf348974578ea)）。
- [FE-03 / Issue #5](https://github.com/jphacks/ng_2601/issues/5)の[PR #22](https://github.com/jphacks/ng_2601/pull/22)はマージ済み（取り込み後のHEADは`abe740b`）。地図表示の実装は[`frontend/src/features/map/`](../src/features/map)です。
- [FE-04 / Issue #6](https://github.com/jphacks/ng_2601/issues/6)の[PR #25](https://github.com/jphacks/ng_2601/pull/25)はマージ済み（マージコミット`6493512`）。経路探索の実装は[`frontend/src/features/route/`](../src/features/route)です。
- [FE-09 / Issue #11](https://github.com/jphacks/ng_2601/issues/11)の[PR #27](https://github.com/jphacks/ng_2601/pull/27)はOPEN・未マージです。確認したheadは[84269ef](https://github.com/jphacks/ng_2601/commit/84269ef95305c7bece4aa810ec480c6bfb06d4c7)（レビュー指摘の修正は以降のコミットで追加）。マージまで採用済みとして扱いません。
- [FE-08 / Issue #10](https://github.com/jphacks/ng_2601/issues/10)の[PR #34](https://github.com/jphacks/ng_2601/pull/34)はOPEN・未マージでした（2026-10-25確認）。確認したheadは[29671c1](https://github.com/jphacks/ng_2601/tree/29671c10410a4e37791ff362229f95eedc0e0901)。Preferencesの実装は[`frontend/src/features/preferences/`](https://github.com/jphacks/ng_2601/tree/29671c10410a4e37791ff362229f95eedc0e0901/frontend/src/features/preferences)のこのコミットだけを指します。
- [Issue #1](https://github.com/jphacks/ng_2601/issues/1)が示す技術検証用リポジトリは参考資料です。そこにある機能を本リポジトリの実装済み機能として扱いません。

状態が変わるPRでは、この確認時点と影響する節を更新してください。最新の担当・進捗はGitHubで再確認します。

## 構成と責務

この表はmainの`6493512`とPR #32時点で確認した状態です。2026-10-24の記録は履歴であり、状態が変わった行はこの表を優先してください。

| 領域 | 確認できた方針・責務 | 実装状態・根拠 |
| --- | --- | --- |
| フロントエンド | 地点・設定入力、地図と検索結果・標高・危険情報・口コミの表示、読み込み／空／失敗状態を扱う | main（6493512）に画面シェル（FE-02）・地図（FE-03）・API基盤（FE-01）・経路検索（FE-04）がある。標高表示はPR #32（未マージ）で追加。設定・口コミ等は未実装。[Epic #2](https://github.com/jphacks/ng_2601/issues/2)の要件 |
| FE開発・通信基盤 | Vite + TypeScript、UIライブラリなし。画面はApiClient経由でモック／HTTPを切り替える | [PR #16](https://github.com/jphacks/ng_2601/pull/16)でマージ済み。`frontend/src/features/`、`frontend/src/ui/`、`frontend/src/api/`、`frontend/src/types/`、`frontend/src/mocks/`に分離 |
| バックエンド | FEから経路探索を依頼し、Preferencesを取得・保存する連携を想定 | [#6](https://github.com/jphacks/ng_2601/issues/6)、[#10](https://github.com/jphacks/ng_2601/issues/10)の要件。`back/`にBE実装があるが（PR #18）、FEの暫定APIとの整合は未合意。`/v1/map-data`は確認したmainに存在しない。構成の詳細は`back/docs/`を参照し、本文書では未確認とする |
| 地図表示 | MapLibreで地点選択、ルート・危険情報・口コミのレイヤー表示、帰属表示 | [#5](https://github.com/jphacks/ng_2601/issues/5)のPR #22で`frontend/src/features/map/`に実装（マージ済み）。ベースマップは国土地理院の淡色地図ラスタ（`style.ts`）、帰属は「地理院タイル」を常時表示。ルートは検索結果（PR #25）を描画し、口コミはモックを重ねており、API接続は#12。道路・危険情報は#11（PR #27・未マージ）でMapLibreのGeoJSONレイヤーとして描画する予定（下の行）。標高・勾配は#7〜#9 |
| 経路探索 | FEは出発地・目的地・車種・坂道許容度を送り、返却された単一経路を描画する | [#6](https://github.com/jphacks/ng_2601/issues/6)で`frontend/src/features/route/`に実装（[PR #25](https://github.com/jphacks/ng_2601/pull/25)・マージ済み。実BE結合は未検証）。BEは`back/backend/app/main.py`の`POST /v1/routes`。地点指定は地図タップのみ（住所検索なし） |
| 車種・坂道許容度（Preferences） | 車種・坂道許容度・詳細パラメータ（交通量・路面・押し歩き）を選び、保存・初期値リセット・再検索に使う | [#10](https://github.com/jphacks/ng_2601/issues/10)で`frontend/src/features/preferences/`に実装（[PR #34](https://github.com/jphacks/ng_2601/pull/34)・未マージ、確認したhead `29671c1`）。選択肢・初期値は`GET /v1/routing-options`、保存・取得は`/v1/auth/me*`（要ログイン。FEのログインは未実装でBE結合は未検証）。編集値は経路検索の`draft`に反映し、再検索まで結果は変わらない |
| 標高・勾配 | 距離・獲得標高・下降量・標高プロファイルの表示と勾配色分け | #7はPR #32の未マージ実装でFEが国土地理院DEMを解析。#8はこの積み上げブランチで100m勾配窓の地図表示を実装し、API型は変更しない。#9も同じ積み上げブランチでグラフと地図の選択位置を連動させる（PR未マージ）。バックエンドとの勾配閾値合意は未確認 |
| 道路・危険情報 | レイヤー・フィルタ・詳細で種類、情報源、更新日時、有効期限を表示 | [#11](https://github.com/jphacks/ng_2601/issues/11)のPR #27（OPEN・未マージ）で`frontend/src/features/hazards/`に実装中。取得は`api/mapDataLoader.ts`が表示領域（bbox）ごとに`getMapData`を呼ぶ。応答はBE担当共有のスニペット`GET /v1/map-data`（公的規制・事故履歴・交通量・ユーザー報告を別々のGeoJSONで返す）の形に合わせたが、このエンドポイントはリポジトリ未確認で、実サーバーとの接続は未検証。FEで4分類（危険／便利／地形／道路設備）と情報区分（公的規制／統計／ユーザー報告）に正規化し、更新日時の不明・欠測、期限切れ、解消済み、未確認を区別して表示する。収集・配信元と保存方式は未決定 |
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

画面 → `ApiClient` → `createMockClient`または`createHttpClient`という境界があります。[API client](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/client.ts)と[切り替え実装](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/index.ts)が根拠です。HTTP clientの存在は、対応するBE APIの稼働・実装を意味しません。

FEは表示と利用者操作、BEは合意したAPIの提供を境界として調整します。ただし勾配色分け（#8）の閾値や、危険情報・口コミの実データ取得責務などは未確定です。[API契約の未合意点](api-contract.md)を先に解決してください。モック結果を実測値・安全性の保証として扱いません。

## 次に確認すること

- FEとBEの接続前に、[api-contract.md](api-contract.md)に挙げた差分と未決定事項を関係Issueで合意する。
- 機能の受入条件は各Issueを使う。結合・モバイル・通信失敗・欠測の検証は[#15](https://github.com/jphacks/ng_2601/issues/15)で集約する。
- 将来構想（リアルタイムナビ、推薦等）はEpic #2で区別されており、現状の構成には含めない。
