# 実行手順
1. PlatformIOのインストール
  以下のサイトに従って入れてください
  - https://logikara.blog/install_platform/
  - https://logikara.blog/init_atom/
    - ただし、New Projectの設定ではBoardをM5Stick-CではなくM5Stack CoreS3にしてください

2. コードの作成とM5Stackへの書き込み
    - accelerate.cppの中身をmain.cppにコピペしてください
    - M5Stack Core3とpcをusbでつないでください
    - 画面下部の[→]ボタンを押してください
    - ターミナルに[SUCCESS]が表示されたらusbを外してください

3. 加速度の計測
   - M5Stackの画面をタッチすると、表示がStatus:PAUSEDとStatus:RECORDINGで切り替わります。RECORDINGのときだけSDカードにデータが保存されます
   - データを分けたい場合はその都度SDカードからデータを回収してください