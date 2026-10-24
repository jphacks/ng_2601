# 実行手順

## 1. PlatformIOのインストール
以下の外部サイトを参考にインストールを行ってください。
- https://logikara.blog/install_platform/
- https://logikara.blog/init_atom/
  - **注意**: New Projectの設定時は、Boardに「M5Stick-C」ではなく「**M5Stack CoreS3**」を選択してください。

## 2. コードの作成とM5Stackへの書き込み
- `accelerate.cpp` の中身をコピーし、`main.cpp` に貼り付けてください[cite: 1]。
- M5Stack CoreS3本体とPCをUSBケーブルで接続します[cite: 1]。
- PlatformIOの画面下部にある **[→]（Upload）** ボタンを押して書き込みを行います[cite: 1]。
- ターミナルに `[SUCCESS]` と表示されたら、USBケーブルを外してください[cite: 1]。

## 3. 加速度の計測
- M5Stackの画面をタッチすると、表示が `Status: PAUSED` と `Status: RECORDING` で切り替わります[cite: 1]。`RECORDING` の状態のときのみ、SDカードへデータが保存されます[cite: 1]。
- 測定データを分けて管理したい場合は、その都度SDカードを取り外してデータを回収してください[cite: 1]。
