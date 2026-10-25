#include <M5Unified.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <math.h>
#include <sys/time.h>
#include <time.h>
#include <atomic>

#if __has_include("device_config.h")
#include "device_config.h"
#else
#include "device_config.example.h"
#endif

namespace {
constexpr uint32_t kImuIntervalMs = 20;
constexpr uint32_t kGpsMaxAgeMs = 2000;
constexpr float kMinSpeedKmph = 3.0f;
constexpr char kQueueDir[] = "/queue";

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
SemaphoreHandle_t queueMutex;
bool queueReady = false;
bool recording = false;
bool wasTouched = false;
uint32_t bootNonce = 0;
uint32_t eventSequence = 0;
uint32_t lastImuMs = 0;
uint32_t lastDisplayMs = 0;
uint32_t lastBumpMs = 0;
uint32_t lastRoughMs = 0;
uint32_t roughStartMs = 0;
float gravityBaselineG = 1.0f;
float roughSumSquares = 0;
float roughPeakG = 0;
uint32_t roughSamples = 0;
std::atomic_bool clockReady{false};

void syncClockFromGps(uint32_t now)
{
    static uint32_t lastSyncMs = 0;
    if (clockReady && now - lastSyncMs < 60000) return;
    if (!gps.date.isValid() || gps.date.age() > kGpsMaxAgeMs ||
        !gps.time.isValid() || gps.time.age() > kGpsMaxAgeMs || gps.date.year() < 2024) return;
    tm utc = {};
    utc.tm_year = gps.date.year() - 1900;
    utc.tm_mon = gps.date.month() - 1;
    utc.tm_mday = gps.date.day();
    utc.tm_hour = gps.time.hour();
    utc.tm_min = gps.time.minute();
    utc.tm_sec = gps.time.second();
    timeval tv = {mktime(&utc), static_cast<suseconds_t>(gps.time.centisecond()) * 10000};
    if (tv.tv_sec > 0 && settimeofday(&tv, nullptr) == 0) {
        clockReady = true;
        lastSyncMs = now;
    }
}

bool usableFix()
{
    return gps.location.isValid() && gps.location.age() <= kGpsMaxAgeMs &&
           gps.date.isValid() && gps.date.age() <= kGpsMaxAgeMs &&
           gps.time.isValid() && gps.time.age() <= kGpsMaxAgeMs &&
           gps.hdop.isValid() && gps.hdop.age() <= kGpsMaxAgeMs &&
           gps.hdop.hdop() > 0 && gps.hdop.hdop() <= 5 &&
           gps.speed.isValid() && gps.speed.age() <= kGpsMaxAgeMs &&
           gps.speed.kmph() >= kMinSpeedKmph;
}

bool enqueueEvent(const char *kind, float peakDeltaG, float rmsG)
{
    if (!queueReady || !usableFix()) return false;
    char id[32];
    snprintf(id, sizeof(id), "%08lx_%08lx", static_cast<unsigned long>(bootNonce),
             static_cast<unsigned long>(++eventSequence));
    char payload[512];
    const int length = snprintf(
        payload, sizeof(payload),
        "{\"schema_version\":1,\"device_id\":\"%s\",\"event_id\":\"%s\","
        "\"kind\":\"%s\",\"observed_at\":\"%04u-%02u-%02uT%02u:%02u:%02uZ\","
        "\"location\":{\"lat\":%.6f,\"lon\":%.6f},"
        "\"peak_delta_g\":%.3f,\"rms_g\":%.3f,\"gps_hdop\":%.2f,\"speed_kmph\":%.2f}",
        CYCLERHUB_DEVICE_ID, id, kind,
        gps.date.year(), gps.date.month(), gps.date.day(),
        gps.time.hour(), gps.time.minute(), gps.time.second(),
        gps.location.lat(), gps.location.lng(), peakDeltaG, rmsG,
        gps.hdop.hdop(), gps.speed.kmph());
    if (length <= 0 || length >= static_cast<int>(sizeof(payload))) return false;

    const String path = String(kQueueDir) + "/" + id + ".json";
    const String temporary = path + ".tmp";
    if (xSemaphoreTake(queueMutex, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    File file = LittleFS.open(temporary, FILE_WRITE);
    const bool written = file && file.write(reinterpret_cast<const uint8_t *>(payload), length) == length;
    if (file) file.close();
    const bool committed = written && LittleFS.rename(temporary, path);
    if (!committed) LittleFS.remove(temporary);
    xSemaphoreGive(queueMutex);
    if (!committed) Serial.println("Event queue write failed");
    return committed;
}

String nextQueuedPath()
{
    String path;
    if (xSemaphoreTake(queueMutex, pdMS_TO_TICKS(500)) != pdTRUE) return path;
    File directory = LittleFS.open(kQueueDir);
    if (directory) {
        File file = directory.openNextFile();
        while (file) {
            const String candidate = file.name();
            if (candidate.endsWith(".json")) {
                path = candidate.startsWith("/queue/") ? candidate : String(kQueueDir) + "/" + candidate;
                file.close();
                break;
            }
            file.close();
            file = directory.openNextFile();
        }
        directory.close();
    }
    xSemaphoreGive(queueMutex);
    return path;
}

String readQueuedEvent(const String &path)
{
    if (xSemaphoreTake(queueMutex, pdMS_TO_TICKS(500)) != pdTRUE) return {};
    File file = LittleFS.open(path, FILE_READ);
    String payload = file ? file.readString() : String();
    if (file) file.close();
    xSemaphoreGive(queueMutex);
    return payload;
}

int postEvent(const String &payload)
{
    const String url(CYCLERHUB_INGEST_URL);
    const bool https = url.startsWith("https://");
    if (!https && (!CYCLERHUB_ALLOW_HTTP || !url.startsWith("http://"))) return -1;
    if (https && !strlen(CYCLERHUB_SERVER_CA_CERT)) return -1;

    HTTPClient http;
    http.setTimeout(4000);
    int response = -1;
    if (https) {
        WiFiClientSecure client;
        client.setCACert(CYCLERHUB_SERVER_CA_CERT);
        if (http.begin(client, url)) {
            http.addHeader("Authorization", String("Bearer ") + CYCLERHUB_DEVICE_TOKEN);
            http.addHeader("Content-Type", "application/json");
            response = http.POST(payload);
            http.end();
        }
    } else {
        WiFiClient client;
        if (http.begin(client, url)) {
            http.addHeader("Authorization", String("Bearer ") + CYCLERHUB_DEVICE_TOKEN);
            http.addHeader("Content-Type", "application/json");
            response = http.POST(payload);
            http.end();
        }
    }
    return response;
}

void uploadTask(void *)
{
    uint32_t lastConnectMs = millis() - 10000;
    for (;;) {
        if (WiFi.status() != WL_CONNECTED) {
            if (millis() - lastConnectMs >= 10000) {
                WiFi.begin(CYCLERHUB_WIFI_SSID, CYCLERHUB_WIFI_PASSWORD);
                lastConnectMs = millis();
            }
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        if (String(CYCLERHUB_INGEST_URL).startsWith("https://") && !clockReady) {
            configTime(0, 0, "pool.ntp.org");
            tm current = {};
            clockReady = getLocalTime(&current, 2000) && current.tm_year >= 124;
            if (!clockReady) {
                vTaskDelay(pdMS_TO_TICKS(5000));
                continue;
            }
        }
        const String path = nextQueuedPath();
        if (!path.isEmpty()) {
            const String payload = readQueuedEvent(path);
            if (!payload.isEmpty()) {
                const int response = postEvent(payload);
                if (response == 201) {
                    if (xSemaphoreTake(queueMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
                        LittleFS.remove(path);
                        xSemaphoreGive(queueMutex);
                    }
                } else {
                    Serial.printf("Upload failed: %d\n", response);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(path.isEmpty() ? 2000 : 1000));
    }
}

void readImu(uint32_t now)
{
    if (now - lastImuMs < kImuIntervalMs) return;
    lastImuMs = now;
    if (!M5.Imu.update()) return;
    const auto data = M5.Imu.getImuData();
    const float magnitude = sqrtf(data.accel.x * data.accel.x +
                                  data.accel.y * data.accel.y + data.accel.z * data.accel.z);
    gravityBaselineG += 0.01f * (magnitude - gravityBaselineG);
    const float delta = fabsf(magnitude - gravityBaselineG);

    if (!recording || !usableFix()) {
        roughStartMs = now;
        roughSamples = 0;
        roughSumSquares = 0;
        roughPeakG = 0;
        return;
    }
    if (delta > 0.60f && now - lastBumpMs > 1500) {
        if (enqueueEvent("bump", delta, delta)) lastBumpMs = now;
    }
    roughSumSquares += delta * delta;
    roughPeakG = fmaxf(roughPeakG, delta);
    ++roughSamples;
    if (now - roughStartMs >= 2000) {
        const float rms = sqrtf(roughSumSquares / roughSamples);
        if (rms > 0.18f && now - lastRoughMs > 5000) {
            if (enqueueEvent("roughness", roughPeakG, rms)) lastRoughMs = now;
        }
        roughStartMs = now;
        roughSamples = 0;
        roughSumSquares = 0;
        roughPeakG = 0;
    }
}
} // namespace

void setup()
{
    M5.begin();
    Serial.begin(115200);
    setenv("TZ", "UTC0", 1);
    tzset();
    gpsSerial.setRxBufferSize(2048);
    gpsSerial.begin(CYCLERHUB_GPS_BAUD, SERIAL_8N1, 18, 17); // CoreS3 Port C
    queueMutex = xSemaphoreCreateMutex();
    queueReady = queueMutex && LittleFS.begin(true) && (LittleFS.exists(kQueueDir) || LittleFS.mkdir(kQueueDir));
    bootNonce = esp_random();
    M5.Display.setTextSize(2);
    M5.Display.fillScreen(BLACK);
    if (queueReady && strlen(CYCLERHUB_WIFI_SSID) && strlen(CYCLERHUB_DEVICE_TOKEN)) {
        WiFi.mode(WIFI_STA);
        xTaskCreate(uploadTask, "cyclerhub-upload", 8192, nullptr, 1, nullptr);
    }
}

void loop()
{
    M5.update();
    while (gpsSerial.available()) gps.encode(gpsSerial.read());
    syncClockFromGps(millis());
    const bool touched = M5.Touch.getCount() > 0;
    if (touched && !wasTouched) recording = !recording;
    wasTouched = touched;

    const uint32_t now = millis();
    readImu(now);
    if (now - lastDisplayMs >= 500) {
        lastDisplayMs = now;
        M5.Display.setCursor(0, 0);
        M5.Display.printf("%s       \n", recording ? "RECORDING" : "PAUSED");
        M5.Display.printf("GPS: %s    \n", usableFix() ? "READY" : "WAIT");
        M5.Display.printf("WiFi: %s    \n", WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE");
        M5.Display.printf("Queue: %s    \n", queueReady ? "READY" : "ERROR");
        M5.Display.println("Tap to toggle");
    }
    delay(2);
}
