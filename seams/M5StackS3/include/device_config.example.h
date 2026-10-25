// Copy to device_config.h and set these values for your own CoreS3.
// Never commit device_config.h: it contains network and ingest credentials.
#pragma once

#define CYCLERHUB_WIFI_SSID ""
#define CYCLERHUB_WIFI_PASSWORD ""
#define CYCLERHUB_INGEST_URL "http://192.168.1.10:8080/v1/device-events"
#define CYCLERHUB_DEVICE_TOKEN ""
#define CYCLERHUB_DEVICE_ID "cores3-demo"
#define CYCLERHUB_GPS_BAUD 115200

// Supply a trusted root CA in PEM form for an HTTPS URL.
#define CYCLERHUB_SERVER_CA_CERT ""
// Enable only for a local LAN demo. HTTP exposes the device token on the network.
#define CYCLERHUB_ALLOW_HTTP 0
