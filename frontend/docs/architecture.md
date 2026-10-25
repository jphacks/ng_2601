# アーキテクチャと実装状態

## 確認時点と根拠

2026-10-25確認。現行checkoutには`frontend/`と`back/`があり、バックエンドの現行API契約は[`back/docs/api.md`](../../back/docs/api.md)、フロントエンドのHTTP境界は`src/api/http.ts`です。以下は実装済みの経路と、認証UIや実BE結合のようにまだ未接続の部分を分けて記載します。

### 2026-10-25 / 標高表示と地図連動

標高プロファイル上の選択位置と地図上のルート位置・区間を双方向に連動させる実装が`features/elevation/selection.ts`と`link.ts`にあります。`Route`型・API契約は変更せず、ブラウザで取得したDEM由来の推定値だけを扱います。詳細・確認結果は[地図とグラフの連動](route-elevation.md#地図とグラフの連動fe-07--issue-9)を参照。実DEMの結合・実BE・実機モバイルは未検証です。

### 2026-10-25 / 標高データの責務

`features/elevation/`は経路成功後に国土地理院DEMを取得し、獲得標高・下降量・平均勾配をFE側で推定します。モックモードでは合成標高を同じ解析処理に渡します。詳しい計算・出典・欠測規則は[ルート標高解析](route-elevation.md)、APIへの影響は[API契約](api-contract.md)を参照してください。

### 過去のIssue／PRへの参照

以下は実装状態の根拠ではなく、作業の来歴を追うための参照です。現行状態は上の表とソースを優先します。
- [Issue #2（FE Epic）](https://github.com/jphacks/ng_2601/issues/2)はOPENです。子Issueは#3・#4・#5がCLOSED、#11を含む他はOPENでした。要件の記載は、実装完了やBEとの合意を意味しません。
- [FE-01 / Issue #3](https://github.com/jphacks/ng_2601/issues/3)の[PR #16](https://github.com/jphacks/ng_2601/pull/16)はマージ済みです。導入されたAPI基盤は`frontend/src/api/`等にあります（初回確認のhead: [b9de6e2](https://github.com/jphacks/ng_2601/tree/b9de6e2bc07f173f00ae6cb8491bf348974578ea)）。
- [FE-03 / Issue #5](https://github.com/jphacks/ng_2601/issues/5)の[PR #22](https://github.com/jphacks/ng_2601/pull/22)はマージ済み（取り込み後のHEADは`abe740b`）。地図表示の実装は[`frontend/src/features/map/`](../src/features/map)です。
- [FE-04 / Issue #6](https://github.com/jphacks/ng_2601/issues/6)の[PR #25](https://github.com/jphacks/ng_2601/pull/25)はマージ済み（マージコミット`6493512`）。経路探索の実装は[`frontend/src/features/route/`](../src/features/route)です。
- [FE-09 / Issue #11](https://github.com/jphacks/ng_2601/issues/11)の[PR #27](https://github.com/jphacks/ng_2601/pull/27)はOPEN・未マージです。確認したheadは[84269ef](https://github.com/jphacks/ng_2601/commit/84269ef95305c7bece4aa810ec480c6bfb06d4c7)（レビュー指摘の修正は以降のコミットで追加）。マージまで採用済みとして扱いません。
- [FE-08 / Issue #10](https://github.com/jphacks/ng_2601/issues/10)の[PR #34](https://github.com/jphacks/ng_2601/pull/34)はOPEN・未マージでした（2026-10-25確認）。確認したheadは[29671c1](https://github.com/jphacks/ng_2601/tree/29671c10410a4e37791ff362229f95eedc0e0901)。Preferencesの実装は[`frontend/src/features/preferences/`](https://github.com/jphacks/ng_2601/tree/29671c10410a4e37791ff362229f95eedc0e0901/frontend/src/features/preferences)のこのコミットだけを指します。
- [Issue #1](https://github.com/jphacks/ng_2601/issues/1)が示す技術検証用リポジトリは参考資料です。そこにある機能を本リポジトリの実装済み機能として扱いません。

状態が変わるPRでは、この確認時点と影響する節を更新してください。最新の担当・進捗はGitHubで再確認します。

## 構成と責務

この表は2026-10-25時点の現行checkoutを確認した状態です。Issue／PRの番号は来歴の参照であり、状態の判断はこの表と現行ソースを優先してください。

| 領域 | 確認できた方針・責務 | 実装状態・根拠 |
| --- | --- | --- |
| フロントエンド | 地点・設定入力、地図と検索結果・標高・道路情報・口コミの表示、読み込み／空／失敗状態を扱う | `src/features/shell/`、`map/`、`route/`、`elevation/`、`hazards/`、`reviews/`、`preferences/`に実装。実API利用は`VITE_API_MODE=http`で選択できる。ログイン画面とアクセストークン保持は未実装のため、認証が必要な操作は実BEでは401になる |
| FE開発・通信基盤 | Vite + TypeScript、UIライブラリなし。画面はApiClient経由でモック／HTTPを切り替える | [PR #16](https://github.com/jphacks/ng_2601/pull/16)でマージ済み。`frontend/src/features/`、`frontend/src/ui/`、`frontend/src/api/`、`frontend/src/types/`、`frontend/src/mocks/`に分離 |
| バックエンド | FEから経路探索、地図データ、観測、設定を受け付け、外部データの出典を返す | `back/backend/app/main.py` と `auth.py` に実装。`POST /v1/routes`、`GET /v1/map-data`、`GET/POST /v1/observations`、`GET /v1/routing-options`、`/v1/auth/me*`などの正本は[`back/docs/api.md`](../../back/docs/api.md)。FEとの実サーバー結合テストは未実施 |
| 地図表示 | MapLibreで地点選択、ルート・道路情報・口コミのレイヤー表示、帰属表示 | `features/map/` と `features/hazards/`、`features/reviews/`に実装。モック／HTTPを切り替え、HTTPモードでは表示領域のbboxを`GET /v1/map-data`へ送る。実データの結合・モバイル実機は未検証 |
| 現在地表示 | 利用者の操作で現在地を1回取得して表示。拒否・タイムアウト・非対応でも地図と手動の地点指定は使える。位置は保存・送信しない | `features/geolocation/`に実装。仕様と制約は[geolocation.md](geolocation.md) |
| 経路探索 | FEは出発地・目的地・車種・4つの設定を送り、返却された単一経路を描画する | `features/route/` と `api/routeAdapter.ts`に実装。HTTPモードは`POST /v1/routes`へ接続し、地点指定は地図タップのみ（住所検索なし）。実BE結合は未検証 |
| 車種・坂道許容度（Preferences） | 車種・坂道許容度・詳細パラメータ（交通量・路面・押し歩き）を選び、初期値・再検索に使う | `features/preferences/`に実装。選択肢・初期値は`GET /v1/routing-options`、保存・取得は`/v1/auth/me*`（要ログイン）。ログインUIとトークン注入は未実装なので、編集値を検索へ送る機能と、認証済み保存の接続状態を分けて扱う |
| 標高・勾配 | 距離・時間・獲得標高・最大上りと標高プロファイルの表示、勾配色分け | `features/elevation/`に実装し、HTTPモードでは国土地理院DEMをブラウザから取得する。これはルートAPIの応答に含まれないFE側の推定値。欠測は結果欄に短く表示し、出典は地図の帰属表示にまとめる。実DEMの結合・実機モバイルは未検証 |
| 道路・危険情報 | レイヤー・フィルタ・詳細で種類、情報源、更新日時、有効期限を表示 | `features/hazards/` と `api/mapDataLoader.ts`に実装。HTTPモードでは表示領域のbboxを`GET /v1/map-data`へ送り、規制・事故・交通量・観測を別レイヤーとして扱う。出典と鮮度はバックエンドのsource metadataを表示する。認証不要の取得は接続済みだが、実データでの受入検証は未実施 |
| 口コミ | 地点に紐づく一覧・詳細・投稿、ユーザー情報と公的情報の区別 | `features/reviews/`に実装。HTTPモードでは`GET /v1/observations`を表示bboxで取得し、投稿は`POST /v1/observations`へ送る。投稿にはBearer認証が必要だが、FEのログインUI・トークン保持は未実装なので実BEでは401になる。モデレーション画面、通報窓口、実BEでの結合検証は未実施 |

## データフロー

以下は現行の通信経路です。モックモードでは同じ境界をモック実装へ切り替えます。

```text
利用者の設定・出発地／目的地
  → FEの入力・表示処理
  → API通信境界
  → BEへの`POST /v1/routes`（BRouter・公式規制・交通量を評価し、事故履歴は別コンテキストで返す）
  → 返却された経路・解析データをFEで地図／グラフ表示

地図の表示領域・選択地点
  → `GET /v1/map-data`／`GET /v1/observations`
  → FEでレイヤー／詳細表示

口コミ投稿入力 → 入力検証 → 投稿API → 取得結果の再表示
```

画面 → `ApiClient` → `createMockClient`または`createHttpClient`という境界があります。[API client](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/client.ts)と[切り替え実装](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/index.ts)が根拠です。HTTP clientの存在は、対応するBE APIの稼働・実装を意味しません。

FEは表示と利用者操作、BEはAPIとデータ出典の提供を境界とします。ログインUIとアクセストークンの保持、実BE結合、実機モバイルは未接続・未検証です。モック結果を実測値・安全性の保証として扱いません。詳細な未合意事項は[API契約](api-contract.md)と[`back/docs/api.md`](../../back/docs/api.md)を確認してください。

## 次に確認すること

- FEとBEの接続検証では、[api-contract.md](api-contract.md)と[`back/docs/api.md`](../../back/docs/api.md)の差分を確認する。
- 機能の受入条件は各Issueを使う。結合・モバイル・通信失敗・欠測の検証は[#15](https://github.com/jphacks/ng_2601/issues/15)で集約する。
- 将来構想（リアルタイムナビ、推薦等）はEpic #2で区別されており、現状の構成には含めない。

## 2026-10-25 ローカル作業差分: CoreS3 路面計測

この作業ツリーでは、CoreS3 がGPS位置付き段差・振動候補をWi-Fi送信し、BEが専用の計測テーブルに保存します。FEは `GET /v1/map-data` の任意フィールド `route_context.surface` を「機器による計測」として道路情報レイヤーに追加表示します。既存のユーザー報告、政府データ、経路計算には混ぜません。API形状と制約は [API契約](api-contract.md) と [BEの詳細](../../back/docs/device-surface.md) を参照してください。実機・実走行の検証とFE/BE担当者レビューは未完了であり、この追記はマージ済み仕様を意味しません。
