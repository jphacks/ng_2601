#include <M5CoreS3.h>
#include <SD.h>
#include <math.h>

const char *filename = "/accel_log.csv";
bool isLogging = false;      // 記録中かどうかのフラグ
bool lastTouchState = false; // 前回のタッチ状態を保持（チャタリング・連続トグル防止用）

void setup()
{
    auto cfg = M5.config();
    CoreS3.begin(cfg);

    Serial.begin(115200);
    delay(1000);

    // 画面の初期設定
    M5.Lcd.setTextColor(WHITE);
    M5.Lcd.setTextSize(2);
    M5.Lcd.fillScreen(BLACK);
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println("SD Accel Logger");

    // microSDカードの初期化
    if (!SD.begin())
    {
        Serial.println("SD Card Mount Failed!");
        M5.Lcd.setTextColor(RED);
        M5.Lcd.println("SD Mount Failed!");
        return;
    }

    Serial.println("SD Card Initialized.");
    M5.Lcd.setTextColor(GREEN);
    M5.Lcd.println("SD Mount Success!");

    // ファイルがなければ、CSVのヘッダー行を作成して書き込む
    File file = SD.open(filename, FILE_APPEND);
    if (file)
    {
        if (file.size() == 0)
        {
            file.println("X[G],Y[G],Z[G],Magnitude[G]");
        }
        file.close();
    }

    delay(1500);
    M5.Lcd.fillScreen(BLACK);
}

void loop()
{
    CoreS3.update();

    // --- タッチ操作の検出（押された瞬間にON/OFFを反転） ---
    int cnt = CoreS3.Touch.getCount();
    bool currentTouched = (cnt > 0);

    if (currentTouched && !lastTouchState)
    {
        // 画面に触れた瞬間にトグル（切り替え）
        isLogging = !isLogging;
    }
    lastTouchState = currentTouched;

    // --- IMU（加速度）データの取得と処理 ---
    if (M5.Imu.update())
    {
        auto data = M5.Imu.getImuData();
        float ax = data.accel.x;
        float ay = data.accel.y;
        float az = data.accel.z;
        float magnitude = sqrt(ax * ax + ay * ay + az * az);

        // 画面上部に現在のステータスを表示
        M5.Lcd.setCursor(0, 10);
        M5.Lcd.setTextSize(2);

        if (isLogging)
        {
            M5.Lcd.setTextColor(GREEN, BLACK);
            M5.Lcd.println("Status: RECORDING");
        }
        else
        {
            M5.Lcd.setTextColor(YELLOW, BLACK);
            M5.Lcd.println("Status: PAUSED   ");
        }

        // 現在の加速度数値をリアルタイム表示
        M5.Lcd.setTextColor(WHITE, BLACK);
        M5.Lcd.setCursor(0, 50);
        M5.Lcd.printf("X: %+6.2f G  \n", ax);
        M5.Lcd.printf("Y: %+6.2f G  \n", ay);
        M5.Lcd.printf("Z: %+6.2f G  \n", az);
        M5.Lcd.printf("Mag: %5.2f G  \n", magnitude);

        // --- ロギング処理（記録中の場合のみSDカードへ書き込み） ---
        if (isLogging)
        {
            File file = SD.open(filename, FILE_APPEND);
            if (file)
            {
                file.printf("%.3f,%.3f,%.3f,%.3f\n", ax, ay, az, magnitude);
                file.close();

                M5.Lcd.setCursor(0, 160);
                M5.Lcd.setTextColor(GREEN, BLACK);
                M5.Lcd.print("[SD Writing...   ]");
            }
            else
            {
                M5.Lcd.setCursor(0, 160);
                M5.Lcd.setTextColor(RED, BLACK);
                M5.Lcd.print("[SD Write Error! ]");
            }
        }
        else
        {
            M5.Lcd.setCursor(0, 160);
            M5.Lcd.setTextColor(DARKGREY, BLACK);
            M5.Lcd.print("[Paused (No Save)]");
        }
    }

    // サンプリング間隔（100ms = 10Hz）
    delay(100);
}