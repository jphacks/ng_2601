# CyclerHub

[日本語](README.md) | [English](README.en.md)

CyclerHub helps cyclists find routes that reflect their bicycle, riding preferences, and available road information.

## Overview

### Background (the problem)

Hills, pavement, traffic, and restrictions can make a significant difference to a bicycle trip. [Japan's transport ministry](https://www.mlit.go.jp/toshi/content/001880113.pdf) has documented a long-term decline in cycling's share of trips. Since April 2026, [Japan's traffic infraction notice system](https://www.npa.go.jp/bureau/traffic/bicycle/info.html) has also applied to cyclists aged 16 and older. CyclerHub aims to help people who feel discouraged by road conditions choose routes that suit them.

### Product description (how it works)

Choose a start and destination, a bicycle type, and preferences for hills, traffic, surfaces, and walking the bicycle. The backend uses [BRouter](https://github.com/abrensch/brouter) to generate candidate routes, excludes routes it can identify as closed using available restriction data, and compares candidates according to the rider's preferences.

Accident history, community reports, and device measurements also appear as context around a route. CyclerHub connects these distinct sources so they can inform route selection as the data and evaluation methods mature.

### Features

#### 1. Bicycle routing informed by multiple sources

Five profiles cover city bicycles, electric-assist bicycles, road bikes, gravel bikes, and mamachari. BRouter generates candidates using bicycle parameters and preferences for hills, traffic, surfaces, and walking; the backend selects a route using road restrictions and sufficiently covered traffic data. **Integrated.**

#### 2. A map that helps riders compare roads

Routes link to estimated elevation profiles and grade colors derived from Geospatial Information Authority of Japan tiles. Accident history, traffic, and community reports appear as distinct layers. **Integrated.**

#### 3. Road information built from ride measurements

An M5Stack CoreS3 and GPS unit capture possible bumps and roughness, then upload and display them. **Implemented, with data collection confirmed on the physical device.** Using those measurements to select routes is a future step.

### What it solves

The same distance can feel very different depending on the bicycle and rider. CyclerHub helps people choose routes that suit their bicycle and preferences, with road restrictions, traffic, hills, and surfaces in view.

### Implemented and evaluated: CoreS3 surface measurements

An M5Stack CoreS3 uses its accelerometer and a GPS unit to record possible bumps and roughness, then sends events over Wi-Fi for display on the map. Data collection on the physical device has been confirmed. The next steps are evaluating detection accuracy and on-road behavior, then using the measurements in route selection. See the [seams documentation](seams/README.md).

### Sign-in and authentication

CyclerHub has a Google sign-in screen. After signing in, riders can use authenticated features such as posting community reports and saving route preferences. The app also handles expired access tokens and sign-out. Email-link authentication is implemented in the backend; connecting it to the user interface is a next step.

### Next steps

We plan to evaluate the reliability and appropriate use of accident history, community reports, and ride measurements before incorporating them into route selection. On-road CoreS3 testing and detection accuracy evaluation are also planned.

The preference-saving screen and API are implemented, as are backend APIs for saving places and routes. The next step is to connect place and route saving to the interface so riders can reuse their everyday settings and routes.

### What we focused on

- **Different bicycles need different routes:** The five profiles have distinct physical parameters and reflect rider preferences.
- **Each source has a clear role:** Restrictions determine whether a candidate is usable, traffic can influence selection, and accident history and reports add context.
- **A path for real road measurements:** The CoreS3 measurement, upload, and display flow provides a foundation for future route evaluation.

## Technology

### Technologies used

#### APIs and data

- OpenStreetMap (used within BRouter)
- Elevation data from the Geospatial Information Authority of Japan
- JARTIC traffic regulations
- National Police Agency accident history
- Traffic volume data

The role of each source is described in the [external data documentation](back/docs/external-data.md).

#### Frameworks, libraries, modules, and devices

- Frontend: TypeScript, Vite, MapLibre GL JS
- Backend: Python, FastAPI, PostgreSQL/PostGIS, BRouter
- Environment: Docker, uv (development), PlatformIO
- Hardware: M5Stack CoreS3 and GPS unit

### Original technology

#### Features and technology built during the hackathon

- Built bicycle-specific [routing settings](back/config/routing_catalog.json) and a [BRouter profile](back/brouter_extension/profiles/japan_bicycle.brf).
- Added a [route API](back/backend/app/main.py) that evaluates BRouter candidates using road restrictions and traffic data.
- Implemented CoreS3 [measurement and upload firmware](seams/M5StackS3/src/main.cpp) and a [device ingest API](back/backend/app/device_events.py).

## Acknowledgements

Thanks to JPHacks2026 technical partner “ ” for providing the M5Stack CoreS3 and GPS unit.

## Developer guides

[Frontend](frontend/README.md) · [Backend](back/README.md) · [CoreS3](seams/README.md) · [Documentation guide](frontend/docs/README.md)
