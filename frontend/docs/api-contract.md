# API契約の案内と未合意事項

## 状態と正本

確認時点は[architecture.md](architecture.md)と同じです。mainにはAPI型定義、OpenAPI、サーバー実装がなく、正式に合意・実装されたAPIは確認できません。

[PR #16（未マージ）](https://github.com/jphacks/ng_2601/pull/16)には暫定型とHTTP clientがあります。以下はhead `b9de6e2`を参照する索引であり、正式なBE仕様ではありません。型の全フィールドやJSON例をこの文書に複製しません。

| 確認する内容 | PR #16内の参照先（暫定） |
| --- | --- |
| リクエスト・レスポンスの構造、単位 | [frontend/src/types/api.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/types/api.ts) |
| UIから呼ぶ操作・戻り値 | [frontend/src/api/client.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/client.ts) |
| HTTPメソッド・パス・query・JSON body | [frontend/src/api/http.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/http.ts) |
| エラーの正規化 | [frontend/src/api/errors.ts](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/src/api/errors.ts) |
| モックと接続設定・実行手順 | [frontend/README.md](https://github.com/jphacks/ng_2601/blob/b9de6e2bc07f173f00ae6cb8491bf348974578ea/frontend/README.md) |

マージ後は実際に取り込まれた型・clientを確認し、上の索引をリポジトリ内の相対リンクへ更新します。正式仕様をOpenAPI等で導入する場合は、構造の正本を一つ選び、型生成または整合確認方法を同じPRで定めます。暫定型を無条件に正式契約へ昇格させません。

## 操作一覧（すべて暫定・サーバー未確認）

下表は参照先の要約です。型の詳細は上のTypeScript、HTTPの詳細はclientを確認してください。

| 用途 | PR #16内のHTTP呼び出し | 入力（bodyまたはquery） | 応答型 |
| --- | --- | --- | --- |
| 経路検索 | PR #16の暫定契約: `POST /routes/search`。現行実装（[PR #25](https://github.com/jphacks/ng_2601/pull/25)・未マージ）: `POST /v1/routes`（[#6](https://github.com/jphacks/ng_2601/issues/6)） | PR #16: body `RouteSearchRequest`。PR #25: `RouteSearchRequest`をBEの`{start,end,bike_type,preferences}`へ変換 | PR #16: `Route[]`。PR #25: `Route`（単一）。BEの`{route: BRouter GeoJSON,...}`から変換 |
| 経路詳細 | `GET /routes/{id}` | path: `id`（string） | `Route` |
| 危険情報一覧（旧・想定） | `GET /hazards` | query: 任意の`routeId` | `Hazard[]`。#11では使わない（`/dev/overview`と#10の`Preferences`が`Hazard`型を参照するため型は残置） |
| 道路・危険情報（表示領域） | `GET /v1/map-data` | query: `min_lon`,`min_lat`,`max_lon`,`max_lat`、任意`limit`（1〜500、既定200） | `MapDataResponse`（下記）。**BE担当共有のスニペットに基づく暫定。リポジトリ内のどのブランチにも未確認** |
| 口コミ一覧 | `GET /reviews` | query: 任意の`routeId`、`hazardId` | `Review[]` |
| 設定取得 | `GET /preferences` | なし | `Preferences` |
| 設定更新 | `PUT /preferences` | body: `Preferences` | `Preferences` |

経路検索のみ、[PR #25（未マージ）](https://github.com/jphacks/ng_2601/pull/25)（確認したhead `9715d5b1f6f5002a669041fb89ac48e6b0cec479`）の`frontend/src/api/http.ts`が`POST /v1/routes`を呼びます（BE: `back/backend/app/main.py`）。リクエスト／応答の変換はPR #25の`frontend/src/api/routeAdapter.ts`、エラーは`{detail}`をFE形式へ正規化（409=`no_route`、422=`invalid_request`、502/503=`routing_unavailable`、タイムアウト=`timeout`）。HTTP 200でもGeoJSONの形式が不正なら、`fromBackendResponse`がstatus 502／`invalid_response`のエラーにします。BEが返さない下降量・最大勾配は`null`で、FEで推測しません。実BEとの結合は未検証です。他の行は引き続き暫定です。

[#13](https://github.com/jphacks/ng_2601/issues/13)には口コミ投稿の想定`POST /reviews`がありますが、確認したPRのApiClientに投稿操作・リクエスト型はありません。未実装・未合意として扱います。

## エラー・単位・座標

- PR #16の暫定`ApiErrorBody`は`code`、`message`、任意の`details`。非2xxで本文がこの形でなければ`http_error`、fetch失敗はstatus `0`／`network_error`です。`toApiError`はその他の例外を`unknown`に正規化します。正式なステータスとエラーコード一覧、タイムアウト・再試行方針は未合意です（経路検索のタイムアウトはPR #25で40秒としたFE側の暫定値）。
- 経路検索以外の成功レスポンスは現状clientで型アサーションされ、実行時の構造検証はありません（経路検索はPR #25で応答の形を検証）。型があることを実サーバー応答の検証済みと解釈しません。
- 暫定`LngLat`は`[経度, 緯度]`順です。距離・標高はm、時間は秒、勾配は%と型名・コメントに示されています。正式な測地系、標高基準、勾配の符号・計算方法・丸め・欠測表現は未合意です。
- `Review.createdAt`は暫定型でISO 8601と記載されています。タイムゾーンは未合意です。
- `GET /v1/map-data`の日時は、FEでは「キー欠落＝欠測」「null・空・不正値＝提供元が不明」「文字列＝値あり」と区別して扱います（#11の提案。BEとは未合意）。タイムゾーンの扱い（オフセット付きISO 8601を想定）も未合意です。

## 接続前に合意する事項

| 項目 | 確認できた差分・次の確認先 |
| --- | --- |
| Preferences更新 | [#10](https://github.com/jphacks/ng_2601/issues/10)は`PATCH`案、PR #16は`PUT`。どちらを採るかFE・BEで決める |
| Preferencesの意味 | #10は車種・坂道許容度・設定範囲を取得する要件。暫定型は最大勾配・階段回避・危険種別回避であり、車種・範囲・初期値の取得はない。重みか上限かも含めて合意する |
| 経路形状・標高 | [#6](https://github.com/jphacks/ng_2601/issues/6)はGeoJSONまたは合意した形状を想定。暫定型は座標配列。区間勾配、形状との対応、null等の欠測表現、計算責務は[#7](https://github.com/jphacks/ng_2601/issues/7)・[#8](https://github.com/jphacks/ng_2601/issues/8)と調整する |
| 危険情報の取得・鮮度 | [#11](https://github.com/jphacks/ng_2601/issues/11)は`GET /v1/map-data`（`restrictions`／`route_context.accidents`・`traffic`／`observations`のGeoJSON FeatureCollectionと各`source_status`／`source`）に合わせて実装。型は[`frontend/src/types/api.ts`](../frontend/src/types/api.ts)の`MapDataResponse`、取得は`ApiClient.getMapData`。未確認・未合意: (1) `_observation_features`のproperties（FEは`observations`テーブル列名と同名と仮定）と`category`の値一覧（FEは部分一致で4分類に対応づけ、未知は「危険／その他」）、(2) `limit`が`observations`以外にも効くか、広域bboxの上限（FEはzoom12未満で取得しない）、(3) 認証、(4) 他エンドポイントと違い`/v1`接頭辞を持つ点、(5) `restrictions`の`confidence`値（FEは`high`＝確認済み、`low`＝未確認、それ以外＝不明と扱う）、(6) 事故履歴・交通量に更新日時・個別IDがなく、`source_status.metadata`の日時で代替している点 |
| 口コミの位置・投稿 | [#12](https://github.com/jphacks/ng_2601/issues/12)は地点単位。暫定型は任意のrouteId／hazardIdで、位置は持たない。#13の投稿型、認証・公開位置・投稿制限も調整する |
| 共通通信仕様 | ベースURL、認証・CORS、入力制約、HTTPステータス、ページング、上限・タイムアウトはBE実装と合わせて決める。clientの既定URLを稼働中サービスとして記載しない |

未決定事項は各行の関連Issueで扱います。推測で穴を埋めず、接続・受入条件に影響する合意をPRにもリンクします。

## 仕様変更時の手順

1. 対象Issue／PRに現行と変更案、FE・BE・モックへの影響、互換性・移行方法を示し、担当者と合意する。
2. 選定した正本を更新し、型・HTTP client・モック・BE・利用箇所を追従させる。片側の変更だけで接続済みとしない。
3. 型チェック・ビルド、入力／正常応答／エラー／欠測、可能ならFE・BE結合を検証する。実行コマンド・結果・接続未検証をPRに残す。
4. この索引と[アーキテクチャ](architecture.md)の影響範囲を更新し、重要な設計判断は[ADR](decisions/README.md)、交代に必要な作業状態は[Handoff](handoffs/README.md)へ残す。
