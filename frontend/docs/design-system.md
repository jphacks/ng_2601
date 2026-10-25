# デザインシステム（Nature Ride）

画面シェル（[Issue #4](https://github.com/jphacks/ng_2601/issues/4)）で導入した共通テーマです。正本は[`frontend/src/styles/tokens.css`](../src/styles/tokens.css)で、色や寸法をコンポーネント側に直書きしません。

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--color-primary` | `#386641` | 操作・フォーカス・アイコン |
| `--color-accent` | `#DDA15E` | 選択背景 |
| `--color-route` | `#2563EB` | 経路線（地図接続後に使用。通常UIには使わない） |
| `--color-background` | `#F7F7F2` | 背景 |
| `--color-surface` | `#FFFFFF` | バー・パネル・ボタン |
| `--color-text` | `#283326` | 文字 |
| `--color-warning` | `#C2410C` | 警告・エラー |
| `--color-category-danger` / `-convenience` / `-terrain` / `-facility` | `--color-warning` / `#0F766E` / `#92400E` / `#6D28D9` | 道路・危険情報のカテゴリ（危険／便利／地形／道路設備）。地図・凡例・一覧で共通。色だけに頼らず、ラベルと線種（実線＝有効、破線＝未確認、点線＝期限切れ・解消済み）でも区別する |

## 検索バーと展開UIの統一ルール

- 検索バー・出発地行・パネル・メニュー・地図ボタンは、同じ背景・枠線・影（`--shadow-floating`）・角丸トークンを使う。
- 検索バーは1つのDOMのまま、CSSの位置だけを下部→上部へ動かす（再マウントなし、入力値を保持）。バーが目的地入力を兼ね、別の目的地入力欄は作らない。
- 展開後のパネルはバー直下に`--space-2`の間隔で置く。PCは左寄せ幅400px、スマホは全幅・高さ約65%。
- `prefers-reduced-motion`では移動・展開アニメーションを無効にする。

コントラスト比は未測定です。測定したら本表に追記してください。
