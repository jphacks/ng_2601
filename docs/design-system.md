# Nature Ride — 共通テーマ

2026-10-24の依頼者指定により、今後のUIと地図の共通パレットは **Nature Ride** を継続使用する。[PR #19](https://github.com/jphacks/ng_2601/pull/19)で導入中。方針は依頼者指定、mainへの反映状況はPRで確認する。

色値の正本は[frontend/src/styles/tokens.css](../frontend/src/styles/tokens.css)。コンポーネントに色値の写しを作らず、CSS変数を使う。パレットを変更する場合は、この正本を更新してコントラストと利用箇所を再確認する。

| 公開トークン | 用途 |
| --- | --- |
| `--color-primary` | 操作アイコン、リンク、チェック状態、ロード中表示 |
| `--color-accent` | 選択状態の背景。上に置く文字は`--color-text` |
| `--color-route` | 将来のMapLibre経路の単色表示。通常の操作・写真アイコンの色には流用しない |
| `--color-background` | 画面背景、入力欄、補助領域 |
| `--color-surface` | パネル、メニュー、検索バー |
| `--color-text` | 本文、見出し、選択状態の文字 |
| `--color-warning` | 危険情報、エラーの意味を示すアイコン |

補助文字、枠線、hover／active／selected、フォーカス、半透明面、影も同じファイルの意味別トークンから参照する。パレットにない独立した青系・灰色系の色値を各CSSへ追加しない。`index.html`のブラウザ用`theme-color`だけはCSS変数を解釈できないため、Backgroundの値をメタデータとして合わせる。

砂色のAccentは白背景上の小さな文字・細い操作アイコンには使わない。選択状態は濃色文字と太字を組み合わせ、危険情報は警告の形状・ラベルを伴わせる。フォーカスはPrimaryの輪郭と白い下地を使い、入力枠も独立したコントラストを持つ派生色にする。

## MapLibreへの受け渡し

地図担当はCSS変数をJavaScriptから読み、MapLibreへ具体的な色文字列を渡す。色の別定義やMapLibre専用のパレット複製は作らない。

```ts
const tokens = getComputedStyle(document.documentElement);
const routeColor = tokens.getPropertyValue("--color-route").trim();
const warningColor = tokens.getPropertyValue("--color-warning").trim();
```

この変更では地図描画、勾配別の色分け・閾値、ルート解析は実装しない。実地図の上でのルート・警告の見え方は#5などの接続時に検証する。

## 検証の基準と記録

通常文字は4.5:1以上、フォーカス・入力枠などの確認対象は3:1以上を目安に、ブラウザが解決した表示色で相対輝度比を計算する。テーマ変更時は`npm run typecheck`・`npm run build`と、既存のブラウザテスト・PC／375px幅・横向き・低い画面での表示を確認する。

2026-10-24の確認では、補助文字／Background 5.71:1、選択文字／Accent 5.86:1、フォーカス／Surface 6.68:1、入力枠／Background 3.48:1。対象11組はすべて基準以上。[測定値](verification/issue-4/nature-ride/contrast.json)と[画面・レイアウト検証](../design-qa.md)を参照。これをアプリ全体のアクセシビリティ認証や実地図上の検証済みという意味にはしない。
