# API契約の案内と未合意事項

## 状態と正本

### 2026-10-25 / 現行API境界

経路検索の現行実装は[`routeAdapter.ts`](../src/api/routeAdapter.ts)、型は[`types/api.ts`](../src/types/api.ts)。バックエンドのHTTP正本は[`back/docs/api.md`](../../back/docs/api.md)で、実BEとの結合検証が済んでいない項目は明記する。

Issue #7の方式に合わせ、検索経路の標高をFEから国土地理院DEMへ問い合わせ、獲得標高・下降量・平均勾配等を**推定値として別途算出**する。外部APIの応答・`Route`契約は変更せず、API由来の標高集計とは混在させない。内部の解析点は欠測を`null`として保持し、解析状態・出典・集計値は[`analyze.ts`](../src/features/elevation/analyze.ts)が定義する。計算責務・欠測規則・出典は[ルート標高解析](route-elevation.md)を参照。地図表示は`RouteAnalysis.summary.windows[100]`を元の経路形状へ距離で対応付ける。区間勾配はFE内のDEM表示データであり、APIの`Route`型へ追加していない。地図・グラフ連動もFE内の選択状態だけで実現し、`Route`型・API契約・モックの通信境界を変更しない。バックエンドとの勾配閾値合意は未確認で、表示規則にAPIの閾値を推測していない。

### 2026-10-24の記録

以下は[architecture.md](architecture.md)にある2026-10-24時点の記録です。その時点のmainにはAPI型定義、OpenAPI、サーバー実装がなく、正式に合意・実装されたAPIは確認できませんでした。

[PR #16](https://github.com/jphacks/ng_2601/pull/16)の作業時点には暫定型とHTTP clientがありました。以下は当時のhead `b9de6e2`を参照する履歴索引で、正式なBE仕様ではありません。型の全フィールドやJSON例をこの文書に複製しません。

| 確認する内容 | PR #16内の参照先（暫定） |
| --- | --- |
| リクエスト・レスポンスの構造、単位 | [frontend/src/types/api.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/types/api.ts) |
| UIから呼ぶ操作・戻り値 | [frontend/src/api/client.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/client.ts) |
| HTTPメソッド・パス・query・JSON body | [frontend/src/api/http.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/http.ts) |
| エラーの正規化 | [frontend/src/api/errors.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/errors.ts) |
| モックと接続設定・実行手順 | [frontend/README.md](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/README.md) |

現行の型・clientはリポジトリ内の`src/api/`と`src/types/`を確認してください。正式仕様をOpenAPI等で導入する場合は、構造の正本を一つ選び、型生成または整合確認方法を同じPRで定めます。暫定型を無条件に正式契約へ昇格させません。

## 操作一覧（FE clientと確認したBE実装）

下表は参照先の要約です。型の詳細は上のTypeScript、HTTPの詳細はclientを確認してください。`BBox` は main の `[minLon, minLat, maxLon, maxLat]` に統一し、道路情報・口コミの両方で使います。

| 用途 | PR #16内のHTTP呼び出し | 入力（bodyまたはquery） | 応答型 |
| --- | --- | --- | --- |
| 経路検索 | PR #16の暫定契約: `POST /routes/search`。現行実装（[PR #25](https://github.com/jphacks/ng_2601/pull/25)・mainにマージ済み）: `POST /v1/routes`（[#6](https://github.com/jphacks/ng_2601/issues/6)） | PR #16: body `RouteSearchRequest`。PR #25: `RouteSearchRequest`をBEの`{start,end,bike_type,preferences}`へ変換 | PR #16: `Route[]`。PR #25: `Route`（単一）。BEの`{route: BRouter GeoJSON,...}`から変換 |
| 経路詳細（開発用legacy） | `GET /routes/{id}` | path: `id`（string） | `Route`。現行BEにはこのエンドポイントがなく、HTTPモードの通常画面では呼ばない。`ApiClient`互換のモック／`/dev/overview`用にメソッドだけ残置 |
| 危険情報一覧（開発用legacy） | `GET /hazards` | query: 任意の`routeId` | `Hazard[]`。現行BEにはこのエンドポイントがなく、通常画面は`GET /v1/map-data`を使う。`/dev/overview`とモック互換のため型・メソッドだけ残置 |
| 道路・危険情報（表示領域） | `GET /v1/map-data` | query: `min_lon`,`min_lat`,`max_lon`,`max_lat`、任意`limit`（1〜500、既定200） | `MapDataResponse`（下記）。BE は`back/backend/app/main.py`。`limit`は全レイヤーに効き、各レイヤーに`truncated`がある。実データで確認したのは`observations`のみ |
| 口コミ一覧 | `GET /v1/observations`（[PR #26](https://github.com/jphacks/ng_2601/pull/26)・mainにマージ済み） | query: `min_lon`、`min_lat`、`max_lon`、`max_lat`（必須）、`category`、`limit` | GeoJSON `FeatureCollection`。FEの[`reviewAdapter.ts`](../src/api/reviewAdapter.ts)で`Review[]`へ変換 |
| 口コミ投稿 | `POST /v1/observations`（mainにマージ済みのPR #26。要Bearer認証） | body: `category`、`location{lat,lon}`、`temporal_kind`、`description`。FEの[`toObservationRequest`](../src/api/reviewAdapter.ts)で`ReviewDraft`から変換 | `{id, verification_state, ...}`のみ。投稿内容は返らないため、FEの[`reviewFromCreated`](../src/api/reviewAdapter.ts)が送信内容と合わせて`Review`を作る |
| 設定の選択肢・初期値 | `GET /v1/routing-options`（BE実装あり。[#10](https://github.com/jphacks/ng_2601/issues/10)） | なし | BE: `{bike_types: {車種: {defaults, capabilities}}, preferences: {条件: values[]}}` → FE `RoutingOptions` |
| 設定取得 | `GET /v1/auth/me`（BE実装あり・要ログイン。#10） | なし（`Authorization: Bearer`） | BE: `{bike_type, preferences: {hill_mode, traffic_mode, surface_mode, walking_mode}}` → FE `RouteConditions` |
| 設定更新 | `PUT /v1/auth/me/preferences`（BE実装あり・要ログイン。#10） | body: `{bike_type, hill_mode, traffic_mode, surface_mode, walking_mode}`（FEは5項目すべて送る） | BEは`{status}`のみ返すため、FEは続けて`GET /v1/auth/me`で再取得する |

経路検索は、`frontend/src/api/http.ts`が`POST /v1/routes`を呼びます（BE: `back/backend/app/main.py`）。リクエスト／応答の変換は`frontend/src/api/routeAdapter.ts`、エラーは`{detail}`をFE形式へ正規化（409=`no_route`、422=`invalid_request`、502/503=`routing_unavailable`、タイムアウト=`timeout`）。HTTP 200でもGeoJSONの形式が不正なら、`fromBackendResponse`がstatus 502／`invalid_response`のエラーにします。BEが返さない下降量・最大勾配は`null`で、FEで推測しません。実BEとの結合は未検証です。リクエストの`bike_type`と`preferences`（`hill_mode`・`traffic_mode`・`surface_mode`・`walking_mode`）は、FEが編集中の値をすべて明示して送ります（変換は`frontend/src/api/preferencesAdapter.ts`の`toBackendRoutePreferences`）。設定の3行はBEの実装（`back/backend/app/main.py`・`auth.py`）に合わせた契約で、応答は`preferencesAdapter.ts`が形式を検証します。FEにログイン機能がないため、実BEでは設定の取得・保存が401（FE `unauthorized`）になります。現行BE契約の詳細は[`back/docs/api.md`](../../back/docs/api.md)を正本とします。

[#13](https://github.com/jphacks/ng_2601/issues/13)の仮API`POST /reviews`は採用せず、#12と同様にBE PR #26の`POST /v1/observations`へ合わせた（`ApiClient.createReview`、`ReviewDraft`型）。FEの暫定判断で未合意: `category`にFEの暫定カテゴリ名をそのまま送る、BEの既定`temporal_kind=temporary`は`expires_at`必須のため`permanent`を送る、コメント上限はFEで500文字（BEは2000）。BEは`Authorization: Bearer`を要求するが、FEにログイン導線・トークン保持はなく、実BEへの投稿は401（FEは「ログインが必要」と表示）になり得る。重複投稿を避ける冪等キーはなく、タイムアウト時はサーバー側で作成済みの可能性がある。

## エラー・単位・座標

- PR #16の暫定`ApiErrorBody`は`code`、`message`、任意の`details`。非2xxで本文がこの形でなければ`http_error`、fetch失敗はstatus `0`／`network_error`です。`toApiError`はその他の例外を`unknown`に正規化します。正式なステータスとエラーコード一覧、タイムアウト・再試行方針は未合意です（経路検索のタイムアウトはPR #25で40秒としたFE側の暫定値）。
- 経路検索は `routeAdapter.ts`、道路情報は `mapDataValidation.ts`、口コミは `reviewAdapter.ts` で応答を検証・変換します。その他の成功レスポンスは型アサーションのみです。型があることを実サーバー応答の検証済みと解釈しません。
- 暫定`LngLat`は`[経度, 緯度]`順です。距離・標高はm、時間は秒、勾配は%と型名・コメントに示されています。正式な測地系、標高基準、勾配の符号・計算方法・丸め・欠測表現は未合意です。
- `Review.createdAt`は暫定型でISO 8601と記載されています。タイムゾーンは未合意です。
- `GET /v1/map-data`の日時は、FEでは「キー欠落＝欠測」「null・空・不正値＝提供元が不明」「文字列＝値あり」と区別して扱います（#11の提案。BEとは未合意）。タイムゾーンの扱いは未合意で、FEはオフセット付きISO 8601（または日付のみ）だけを「値あり」とし、オフセットの無い日時・暦として不正な日付は「不明」にします。

## 接続前に合意する事項

| 項目 | 確認できた差分・次の確認先 |
| --- | --- |
| Preferences更新・意味 | #10の`PATCH`案・PR #16の暫定`PUT /preferences`・最大勾配等の暫定型は採用せず、BEの`PUT /v1/auth/me/preferences`に合わせた。「坂道許容度」は最大勾配(%)でも数値の重みでもなく、BEの3段階`hill_mode`（avoid / balanced / accept。BRouterへ0/1/2で渡る）。車種ごとの初期値は`routing-options`で取得する。`routing-options`は日本語表示名を返さないため、表示名はFEが持つ（BEの値の意味は未確認）。#10の暫定候補（クロス・MTB）とBEの車種（グラベル・ママチャリ）が食い違うため、BEの5車種を採用した |
| 経路形状・標高 | [#6](https://github.com/jphacks/ng_2601/issues/6)はGeoJSONまたは合意した形状を想定。暫定型は座標配列。#7/#8のFE表示はDEM由来の`RouteAnalysis`を利用し、`Route`契約に区間勾配を追加しない。欠測と100m窓の対応規則は[ルート標高解析](route-elevation.md)を参照。バックエンドとの勾配閾値合意は未確認 |
| 危険情報の取得・鮮度 | [#11](https://github.com/jphacks/ng_2601/issues/11)は`GET /v1/map-data`（`restrictions`／`route_context.accidents`・`traffic`／`observations`のGeoJSON FeatureCollectionと各`source_status`／`source`）に合わせて実装。型は[`frontend/src/types/api.ts`](../src/types/api.ts)の`MapDataResponse`、取得は`ApiClient.getMapData`。2026-10-25にローカルの実BE（`seed_dev.sh`のデータ）で`observations`の形を確認済み（報告のIDは`properties`ではなく`Feature.id`、各レイヤーに`truncated`がある）。未確認・未合意: (1) `category`の値一覧（BEは自由入力の文字列。FEは部分一致で4分類に対応づけ、未知は「危険／その他」）、(2) 広域bboxの上限（BEは`MAX_MAP_BBOX_AREA_DEG2`、既定25平方度。FEはzoom12未満で取得しない）、(3) 認証、(4) `restrictions`の`confidence`値（FEは`high`＝確認済み、`low`＝未確認、それ以外＝不明と扱う）、(5) 事故履歴・交通量に更新日時・個別IDがなく、`source_status.metadata`の日時で代替している点 |
| 口コミの取得・投稿 | [#12](https://github.com/jphacks/ng_2601/issues/12)のFEはPR #26の`observations`（点・bbox取得）に合わせた暫定実装。未合意: 投稿者表示名（BEは`author_user_id`のみで未返却。FEは未設定なら「匿名ユーザー」）、`category`の値一覧（FEの暫定表で分類し未知は「その他」）、`description`がnullの扱い、`verification_state`の表示方針、取得件数上限（`limit`）超過時の扱い。投稿の認証・公開位置・投稿制限・通報窓口も調整する（#13） |
| 共通通信仕様 | ベースURL、認証・CORS、入力制約、HTTPステータス、ページング、上限・タイムアウトはBE実装と合わせて決める。clientの既定URLを稼働中サービスとして記載しない |

未決定事項は各行の関連Issueで扱います。推測で穴を埋めず、接続・受入条件に影響する合意をPRにもリンクします。

## 仕様変更時の手順

1. 対象Issue／PRに現行と変更案、FE・BE・モックへの影響、互換性・移行方法を示し、担当者と合意する。
2. 選定した正本を更新し、型・HTTP client・モック・BE・利用箇所を追従させる。片側の変更だけで接続済みとしない。
3. 型チェック・ビルド、入力／正常応答／エラー／欠測、可能ならFE・BE結合を検証する。実行コマンド・結果・接続未検証をPRに残す。
4. この索引と[アーキテクチャ](architecture.md)の影響範囲を更新し、重要な設計判断は[ADR](decisions/README.md)、交代に必要な作業状態は[Handoff](handoffs/README.md)へ残す。

## CoreS3 路面計測（試験実装）

[`back/backend/app/device_events.py`](../../back/backend/app/device_events.py) の `POST /v1/device-events` は専用トークンを使う機器向け入力です。詳細は [`back/docs/device-surface.md`](../../back/docs/device-surface.md) を参照してください。`GET /v1/map-data` には任意の `route_context.surface` が追加され、FEは「機器による計測」として表示します。既存の提供元は必須のままです。路面の段差・振動は未確認の候補で、経路の重み付けには使いません。BE/FE担当者のレビューと実機検証は未完了です。
