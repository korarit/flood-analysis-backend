# Backend Requirements — Water Situation Platform

> **Version:** 1.1
> **Scope:** Backend / Data / Storage / API
> **หมายเหตุ:** ไม่รวมการสร้าง Hydrological Model, DEM Processing, Watershed Processing และ Chain of River แต่ Backend ต้องรองรับการจัดเก็บข้อมูลผลลัพธ์เหล่านี้ในอนาคต

---

# 1. แนวคิดหลัก

ระบบใช้ Architecture แบบ:

> **One Platform + One Backend + Multiple Basins**

การแยกลุ่มน้ำทำผ่าน `basin` ไม่แยก Backend หรือ API ตามลุ่มน้ำ

```text
                    ┌─────────────────┐
                    │    ThaiWater    │
                    └────────┬────────┘
                             │
                          Cronjob
                             │
                 ┌───────────┴───────────┐
                 │                       │
                 ▼                       ▼
          Relational DB                  R2
          Master Data              Public Dataset
                 │                       │
                 │                ┌──────┼─────────┐
                 │                │      │         │
                 │              Current History Spatial
                 │                │      │         │
                 └──────────┬─────┴──────┴─────────┘
                            │
                            ▼
                          API
                            │
                            ▼
                         Frontend
```

**จุดสำคัญของ Architecture นี้คือ**

* DB ใช้เก็บ Master Data ที่ต้อง Query
* R2 เป็น Public Object Storage สำหรับข้อมูลที่ Frontend อ่านโดยตรง
* API ไม่จำเป็นต้อง Proxy ข้อมูลจาก R2
* Frontend สามารถโหลด JSON/GeoJSON จาก R2 โดยตรง
* API ใช้สำหรับข้อมูลที่ต้องผ่าน Logic / Query / Management
* Cronjob เป็นตัวดึงและสร้าง Dataset บน R2

---

# 2. Storage Responsibility

## 2.1 Relational Database

DB หลักเก็บเฉพาะข้อมูล Metadata / Registry

```text
Basin
Station
Station Type
Source
Configuration
Dataset Registry
```

---

## 2.2 Cloudflare R2

R2 ใช้เป็น Data Storage สำหรับข้อมูลที่มีปริมาณมากหรือเหมาะกับการอ่านแบบ Static Object

เช่น:

```text
Station Detail
Current Data
Historical Data
Station List
Station Relationship
Spatial Data
River Data
Catchment Data
Model Output
Forecast Data
```

Frontend สามารถอ่านข้อมูลเหล่านี้จาก R2 โดยตรง

```text
Frontend
   │
   └──────────────► R2 Public URL
```

ไม่จำเป็นต้อง:

```text
Frontend → API → R2 → API → Frontend
```

---

# 3. Database Schema

## 3.1 `basins`

```text
basins
────────────────────────────
id
slug
name_th
name_en
description_th
description_en
status
created_at
updated_at
```

### Fields

| Field            | Description                  |
| ---------------- | ---------------------------- |
| `id`             | Internal ID                  |
| `slug`           | Public identifier เช่น `yom` |
| `name_th`        | ชื่อลุ่มน้ำภาษาไทย           |
| `name_en`        | ชื่อลุ่มน้ำภาษาอังกฤษ        |
| `description_th` | รายละเอียดภาษาไทย            |
| `description_en` | รายละเอียดภาษาอังกฤษ         |
| `status`         | active / inactive            |

---

# 4. Station Master Data

## 4.1 `stations`

DB เก็บเฉพาะข้อมูลหลักของสถานี

```text
stations
────────────────────────────
id
basin_id
type
lat
lon
name_th
name_en
address_th
address_en
agency_name_th
agency_name_en
source
source_station_id
status
created_at
updated_at
```

ข้อมูลที่ต้องเก็บตาม Requirement:

* Station ID
* Latitude
* Longitude
* Name Thai
* Name English
* Address Thai
* Address English
* Full Agency Name Thai
* Full Agency Name English
* Basin
* Station Type

---

# 5. Station Type

รองรับอย่างน้อย:

```text
water_level
rainfall
```

ตัวอย่าง:

```json
{
  "id": "Y-0014",
  "type": "water_level"
}
```

และ:

```json
{
  "id": "P-0021",
  "type": "rainfall"
}
```

ไม่ควรใช้ชื่อภาษาไทยเป็น enum ภายในระบบ

---

# 6. Station Source

Station มาจาก ThaiWater เป็นหลัก

ควรเก็บ:

```text
source = thaiwater
source_station_id
```

เพื่อให้สามารถรองรับ Source อื่นในอนาคตได้

```text
ThaiWater
    │
    ├── Y-0014
    ├── Y-0015
    └── P-001

Future Source
    │
    └── ...
```

---

# 7. Station Status

รองรับ:

```text
active
inactive
unknown
```

หาก ThaiWater หยุดส่ง Station ไม่ควรลบ Record ออกจาก DB ทันที

ให้เปลี่ยนเป็น:

```text
inactive
```

เพื่อไม่ทำลาย Reference ของ Historical Data

---

# 8. R2 Public Data Architecture

R2 Bucket เป็น **Public Read**

Frontend สามารถอ่าน Object โดยตรง

ตัวอย่าง:

```text
https://data.example.com/
```

หรือ Public R2 Domain ที่กำหนดไว้

โครงสร้าง Object ควรแบ่งตาม Basin:

```text
/basin/
    /yom/
    /nan/
    /ping/
```

เพื่อให้ระบบรองรับหลายลุ่มน้ำ

---

# 9. R2 Object Structure

โครงสร้างแนะนำ:

```text
basin/
└── yom/
    ├── basin.json
    ├── stations.json
    │
    ├── stations/
    │   ├── Y-0014/
    │   │   ├── detail.json
    │   │   ├── current.json
    │   │   ├── history/
    │   │   │   ├── 2026-08-22.json
    │   │   │   └── 2026-08-21.json
    │   │   └── relations.json
    │   │
    │   └── Y-0015/
    │
    ├── rainfall/
    │
    ├── spatial/
    │   ├── boundary.geojson
    │   ├── rivers.geojson
    │   ├── drainage.geojson
    │   └── catchments.geojson
    │
    └── model/
```

---

# 10. Basin Dataset

Object:

```text
/basin/{basin}/basin.json
```

ตัวอย่าง:

```json
{
  "id": 1,
  "slug": "yom",
  "name": {
    "th": "ลุ่มน้ำยม",
    "en": "Yom Basin"
  },
  "updatedAt": "2026-08-22T18:05:00+07:00"
}
```

Frontend สามารถโหลดโดยตรง:

```text
R2 → /basin/yom/basin.json
```

---

# 11. Station List

Object:

```text
/basin/{basin}/stations.json
```

เป็นข้อมูลสำหรับหน้า Station List และ Map

ตัวอย่าง:

```json
{
  "schemaVersion": "1.0",
  "basin": "yom",
  "generatedAt": "2026-08-22T18:05:00+07:00",
  "stations": [
    {
      "id": "Y-0014",
      "type": "water_level",
      "lat": 17.123,
      "lon": 99.456,
      "name": {
        "th": "ศรีสัชนาลัย",
        "en": "Si Satchanalai"
      }
    }
  ]
}
```

**ไม่ต้องผ่าน API**

```text
Frontend
   ↓
R2
   ↓
stations.json
```

---

# 12. Station Detail

Object:

```text
/basin/{basin}/stations/{station_id}/detail.json
```

ตัวอย่าง:

```json
{
  "schemaVersion": "1.0",
  "station": {
    "id": "Y-0014",
    "type": "water_level",
    "name": {
      "th": "ศรีสัชนาลัย",
      "en": "Si Satchanalai"
    },
    "address": {
      "th": "...",
      "en": "..."
    },
    "agency": {
      "th": "...",
      "en": "..."
    },
    "location": {
      "lat": 17.123,
      "lon": 99.456
    }
  },
  "updatedAt": "2026-08-22T18:05:00+07:00"
}
```

Frontend อ่านตรงจาก R2

---

# 13. Current Data

Object:

```text
/basin/{basin}/stations/{station_id}/current.json
```

สำหรับ Water Level:

```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "timestamp": "2026-08-22T18:05:00+07:00",
  "stage": 5.82,
  "discharge": 285,
  "status": "fresh"
}
```

สำหรับ Rainfall:

```json
{
  "schemaVersion": "1.0",
  "stationId": "P-001",
  "timestamp": "2026-08-22T18:00:00+07:00",
  "value": 42.5,
  "unit": "mm",
  "period": "1h",
  "status": "fresh"
}
```

---

# 14. Historical Data

เก็บแยกตามวัน:

```text
/basin/yom/stations/Y-0014/history/
    2026-08-22.json
    2026-08-21.json
    2026-08-20.json
```

ข้อดี:

* ไม่ต้องโหลดข้อมูลทั้งหมด
* Cache ได้ง่าย
* Update เฉพาะวันปัจจุบัน
* ลบข้อมูลเก่าได้ง่าย
* Frontend โหลดเฉพาะช่วงที่ต้องการ

---

# 15. Historical Water Level

```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "date": "2026-08-22",
  "observations": [
    {
      "timestamp": "2026-08-22T17:00:00+07:00",
      "stage": 5.72,
      "discharge": 280,
      "status": "valid"
    },
    {
      "timestamp": "2026-08-22T18:00:00+07:00",
      "stage": 5.82,
      "discharge": 285,
      "status": "valid"
    }
  ]
}
```

---

# 16. Historical Rainfall

```json
{
  "schemaVersion": "1.0",
  "stationId": "P-001",
  "date": "2026-08-22",
  "observations": [
    {
      "timestamp": "2026-08-22T18:00:00+07:00",
      "value": 42.5,
      "unit": "mm",
      "period": "1h",
      "status": "valid"
    }
  ]
}
```

---

# 17. Historical Retention

ระบบต้องรองรับย้อนหลัง:

```text
สูงสุด 7 วัน
```

ดังนั้น Cronjob ต้องลบ Object ที่เก่ากว่า Retention Period

ตัวอย่าง:

```text
วันนี้ = 22 Aug

เก็บ:
22
21
20
19
18
17
16

ลบ:
15 และเก่ากว่า
```

แต่ควรทำให้ Configuration ได้:

```text
HISTORY_RETENTION_DAYS=7
```

---

# 18. Station Relationship

Object:

```text
/basin/{basin}/stations/{station_id}/relations.json
```

ตัวอย่าง:

```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "relations": [
    {
      "type": "rainfall_influence",
      "targetStationId": "P-001",
      "weight": 0.42
    },
    {
      "type": "rainfall_influence",
      "targetStationId": "P-002",
      "weight": 0.31
    }
  ],
  "generatedAt": "2026-08-22T12:00:00+07:00"
}
```

Backend **ไม่ต้องคำนวณข้อมูลนี้**

แต่ต้องรองรับ:

* เก็บ
* Version
* Update
* Validate
* Publish
* Serve ผ่าน Public R2

---

# 19. Chain of River Data

แม้ไม่ได้ทำ Chain of River ใน Backend แต่ต้องเตรียม Storage

ตัวอย่าง:

```text
/basin/yom/river/
    river-network.json
    stations.json
```

หรือ:

```text
/basin/yom/river/chain.json
```

ตัวอย่าง:

```json
{
  "schemaVersion": "1.0",
  "river": "yom",
  "stations": [
    "Y-0001",
    "Y-0002",
    "Y-0003",
    "Y-0014"
  ]
}
```

Backend ไม่จำเป็นต้องสร้างข้อมูลนี้ แต่ API/Storage Architecture ต้องไม่ขัดขวางการเพิ่มข้อมูลในอนาคต

---

# 20. Spatial Data

รองรับไฟล์:

```text
GeoJSON
GeoJSON Sequence
Vector Tiles
```

ตามขนาด Dataset

โครงสร้าง:

```text
/basin/{basin}/spatial/
    boundary.geojson
    rivers.geojson
    drainage.geojson
    catchments.geojson
```

Frontend โหลดตรงจาก R2

---

# 21. Model Output

Backend ต้องรองรับการจัดเก็บผลจาก Model

ตัวอย่าง:

```text
/basin/yom/model/
    rainfall-runoff/
    forecast/
    flood/
```

เช่น:

```text
/basin/yom/model/forecast/
    2026-08-22T18:00.json
```

Backend ไม่สร้าง Model แต่ต้องรองรับ Dataset ที่มี:

```text
basin
station
timestamp
model_version
generated_at
data
```

---

# 22. Dataset Metadata

ทุก Dataset บน R2 ควรมี:

```text
schemaVersion
generatedAt
updatedAt
source
```

ถ้าเป็น Model:

```text
modelVersion
```

ถ้าเป็น Derived Dataset:

```text
datasetVersion
```

---

# 23. Public R2 Rules

แม้ Bucket เป็น Public แต่ **ไม่ใช่ทุก Object จะ Public**

ต้องแบ่ง:

```text
PUBLIC
├── basin.json
├── stations.json
├── station/detail.json
├── station/current.json
├── station/history/*
├── station/relations.json
└── spatial/*
```

ส่วน:

```text
PRIVATE
├── raw ThaiWater response
├── ingestion logs
├── internal processing files
└── credentials/config
```

ห้ามเอาข้อมูลเหล่านี้ไว้ใน Public Bucket

แนะนำให้มีอย่างน้อย:

```text
public-data-bucket
private-data-bucket
```

หรือแยก Prefix ที่มี Access Policy ชัดเจน หาก Infrastructure รองรับตามต้องการ

---

# 24. API Responsibility

หลังจากเปลี่ยนมาใช้ Public R2 แล้ว API **ไม่ต้องทำหน้าที่เป็น Data Proxy**

ดังนั้นไม่ต้องมี:

```text
GET /api/basins/yom/stations/Y-0014/current
GET /api/basins/yom/stations/Y-0014/history
GET /api/basins/yom/stations/Y-0014/detail
```

หากข้อมูลเหล่านี้เป็น Static Dataset บน R2

Frontend โหลด:

```text
R2/current.json
R2/history/2026-08-22.json
R2/detail.json
```

โดยตรง

---

# 25. API ที่ยังจำเป็น

API ควรเหลือสำหรับข้อมูลที่ต้อง Query หรือมี Business Logic

เช่น:

```http
GET /api/basins
```

```http
GET /api/basins/{slug}
```

และ Internal/Admin API:

```http
POST /api/admin/sync/stations
POST /api/admin/sync/observations
POST /api/admin/datasets/rebuild
```

รวมถึง API ที่ต้องทำ Dynamic Query จริง ๆ ในอนาคต

---

# 26. Public R2 URL Convention

Frontend ไม่ควร Hard-code URL หลายรูปแบบ

กำหนด Base URL:

```text
PUBLIC_DATA_BASE_URL
```

เช่น:

```text
https://data.example.com
```

แล้วสร้าง Path:

```text
{BASE}/basin/yom/stations/Y-0014/current.json
```

ดังนั้นถ้าเปลี่ยน CDN / Domain:

```text
data.example.com
```

เป็น:

```text
cdn.example.com
```

Frontend ไม่ต้องเปลี่ยน Logic

---

# 27. R2 Cache Strategy

เนื่องจาก Frontend อ่าน R2 โดยตรง ต้องตั้ง Cache-Control ให้เหมาะกับ Dataset

ตัวอย่าง:

### Basin

```text
Cache-Control: public, max-age=3600
```

### Station Detail

```text
Cache-Control: public, max-age=3600
```

### Current

```text
Cache-Control: public, max-age=60
```

### Historical

```text
Cache-Control: public, max-age=3600
```

### Spatial

```text
Cache-Control: public, max-age=86400
```

ค่าจริงควรปรับตามรอบ Update ของแต่ละ Dataset

---

# 28. Atomic Dataset Update

จุดสำคัญมากสำหรับ Public R2

ไม่ควรเขียนไฟล์ Current แบบที่ Frontend อาจอ่านขณะที่ไฟล์กำลังถูกเขียน

ควรใช้แนวทาง:

```text
Generate
   ↓
Validate
   ↓
Upload complete object
   ↓
Replace / publish
```

เช่น:

```text
current.tmp.json
      ↓
validate
      ↓
current.json
```

Frontend จะเห็น Dataset ที่สมบูรณ์เท่านั้น

---

# 29. Data Validation ก่อน Publish

ก่อน Publish Dataset ลง Public R2 ต้องตรวจ:

```text
JSON valid
Schema valid
Station ID valid
Basin valid
Timestamp valid
Unit valid
Required fields present
```

หาก Validation fail:

```text
ไม่ Publish
```

และเก็บ Error ไว้ใน Log

---

# 30. ThaiWater Sync

Flow ใหม่:

```text
                ThaiWater
                    │
                    ▼
              Cron Scheduler
                    │
                    ▼
             Fetch Raw Data
                    │
                    ▼
               Validate
                    │
                    ▼
               Normalize
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
         DB                  R2
     Master Data       Public Dataset
```

---

# 31. Station Sync

```text
ThaiWater Station API
        ↓
Station Adapter
        ↓
Normalize
        ↓
Validate
        ↓
DB
        ↓
Generate stations.json
        ↓
R2
```

ดังนั้น DB เป็น **Master Registry**

แต่ `stations.json` เป็น **Public Read Dataset**

---

# 32. Observation Sync

```text
ThaiWater
    ↓
Fetch Observation
    ↓
Validate
    ↓
Normalize
    ↓
Write History
    ↓
Update Current
```

เช่น:

```text
R2
├── current.json
└── history/
      └── 2026-08-22.json
```

---

# 33. R2 เป็น Read-Optimized Data Layer

หลักคิด:

```text
DB
=
System of Record / Metadata

R2
=
Public Read Dataset
```

ดังนั้น Frontend ไม่ควร Query DB โดยตรง

และไม่ควรยิง ThaiWater โดยตรง

```text
Frontend
    │
    ├──── DB ❌
    ├──── ThaiWater ❌
    │
    └──── R2 ✅
```

สำหรับข้อมูลที่เป็น Static/Published Dataset

---

# 34. Data Flow สำหรับหน้า Station

ตัวอย่างหน้า:

```text
/basin/yom/station/Y-0014
```

Frontend โหลด:

```text
1. /basin/yom/basin.json
2. /basin/yom/stations/Y-0014/detail.json
3. /basin/yom/stations/Y-0014/current.json
4. /basin/yom/stations/Y-0014/history/2026-08-22.json
5. /basin/yom/stations/Y-0014/history/2026-08-21.json
6. /basin/yom/stations/Y-0014/relations.json
```

ทั้งหมด:

```text
Frontend → R2
```

ไม่มี API Proxy

---

# 35. Data Flow สำหรับ Map

Frontend:

```text
/basin/yom/map
```

โหลด:

```text
/basin/yom/stations.json
```

และ:

```text
/basin/yom/spatial/boundary.geojson
/basin/yom/spatial/rivers.geojson
```

จากนั้น Marker สามารถโหลด Current Data ตามที่จำเป็น

หรือ Backend Cron สามารถสร้าง `stations.json` ให้มี Current Summary ติดไปด้วย:

```json
{
  "id": "Y-0014",
  "type": "water_level",
  "lat": 17.123,
  "lon": 99.456,
  "current": {
    "stage": 5.82,
    "discharge": 285,
    "status": "fresh"
  }
}
```

**วิธีนี้เหมาะมากกับ Map** เพราะไม่ต้องยิง `current.json` 40–100 สถานีแยกกัน

---

# 36. Data Flow สำหรับ Overview

ควรมี Dataset สำเร็จรูป:

```text
/basin/yom/overview.json
```

ตัวอย่าง:

```json
{
  "generatedAt": "...",
  "summary": {
    "waterLevelStations": 32,
    "rainfallStations": 18,
    "warningStations": 6
  },
  "waterLevel": [],
  "rainfall": []
}
```

Frontend โหลดเพียง:

```text
GET R2 /basin/yom/overview.json
```

ไม่ต้องยิง API หลาย endpoint

---

# 37. R2 Dataset Generation

Cron สามารถสร้าง Dataset สำหรับ UI โดยเฉพาะได้

```text
DB
+
Latest Observation
+
Configuration
       ↓
Dataset Generator
       ↓
overview.json
stations.json
current.json
```

ทำให้ Backend ไม่ต้องทำ Dynamic Query ทุกครั้งที่ User เปิดหน้า

---

# 38. Database Load

ด้วย Architecture นี้ DB จะรับภาระน้อยมาก

User 1,000 คนเปิด Station Detail:

### ไม่ใช้ Architecture นี้

```text
1,000 users
 ↓
1,000 API requests
 ↓
DB
```

### Architecture ที่ออกแบบใหม่

```text
1,000 users
      ↓
     R2/CDN
      ↓
Cached Objects
```

DB แทบไม่เกี่ยวข้องกับ Traffic ของ Public Read

นี่เป็นข้อดีหลักของการให้ R2 เป็น Public Dataset

---

# 39. Cron Failure

ถ้า ThaiWater ล่ม:

```text
ThaiWater ❌
```

ข้อมูลเดิมบน R2 ยังคงอยู่

Frontend จะยังอ่าน:

```text
current.json
```

ได้

แต่ต้องระบุ:

```json
{
  "timestamp": "2026-08-22T15:00:00+07:00",
  "status": "stale"
}
```

ดังนั้น User จะเห็นว่า:

> ข้อมูลล่าสุด 15:00 น. และข้อมูลอาจล่าช้า

ไม่ควรลบข้อมูลเดิมเพียงเพราะ Sync รอบล่าสุดล้มเหลว

---

# 40. Raw ThaiWater Data

Raw Data **ไม่ควรอยู่ Public Bucket**

เก็บใน Private R2:

```text
private/
└── raw/
    └── thaiwater/
        └── 2026/
            └── 08/
                └── 22/
```

เพื่อใช้สำหรับ:

* Debug
* Audit
* Reprocess
* ตรวจสอบข้อมูลย้อนหลัง

---

# 41. Dataset Registry

แม้ Dataset จะอยู่ R2 แต่ควรมี Registry ใน DB เพื่อรู้ว่า Dataset ไหนมีอยู่

ตัวอย่าง Table:

```text
datasets
────────────────────────────
id
basin_id
type
path
version
generated_at
updated_at
status
```

ตัวอย่าง:

```text
basin = yom
type = stations
path = basin/yom/stations.json
version = 1.0
status = published
```

**ไม่ได้มีไว้ให้ Frontend Query ทุกครั้ง**

มีไว้สำหรับ Backend/Admin/Monitoring

---

# 42. Dataset Types

รองรับ:

```text
basin
overview
stations
station_detail
current
history
relations
river
spatial
model
forecast
```

สามารถเพิ่มประเภทใหม่ได้

---

# 43. Dataset Versioning

Dataset ที่สำคัญควรมี:

```text
schemaVersion
datasetVersion
generatedAt
```

ตัวอย่าง:

```json
{
  "schemaVersion": "1.0",
  "datasetVersion": "2026.08.22.1805"
}
```

เพื่อรองรับการเปลี่ยน Schema ในอนาคต

---

# 44. Backend API Scope หลังปรับ Architecture

### Public API

```http
GET /api/basins
GET /api/basins/{slug}
```

อาจมีเพิ่มเฉพาะ Dynamic Query ที่จำเป็นจริง ๆ

### Internal/Admin

```http
POST /api/admin/sync/stations
POST /api/admin/sync/observations
POST /api/admin/datasets/rebuild
GET  /api/admin/jobs
GET  /api/admin/data-quality
```

### ไม่ทำ API Proxy

```text
❌ /api/.../history
❌ /api/.../current
❌ /api/.../detail
❌ /api/.../relations
❌ /api/.../spatial
```

หากข้อมูลเหล่านี้เป็น Public Dataset ใน R2

---

# 45. Security

แม้ข้อมูลบน R2 จะ Public แต่:

**Public Dataset**

```text
Station metadata
Current observation
History
Spatial
Relationship
```

**Private**

```text
ThaiWater credentials
Raw API response
Internal logs
Job information
Database
Admin configuration
Model training data หากมีข้อมูลที่ไม่ควรเผยแพร่
```

ต้องไม่ใส่ Secret หรือข้อมูลภายในลง Public Bucket

---

# 46. CORS

เนื่องจาก Frontend จะโหลด R2 จาก Browser โดยตรง ต้องกำหนด CORS ของ R2 ให้รองรับ Domain ของ Frontend

ตัวอย่างแนวคิด:

```text
Allowed Origins:
https://example.com
https://www.example.com

Allowed Methods:
GET
HEAD
```

ไม่จำเป็นต้องเปิด:

```text
PUT
POST
DELETE
```

ให้ Public Browser

---

# 47. Content-Type

R2 ต้องส่ง Content-Type ถูกต้อง

```text
.json
→ application/json

.geojson
→ application/geo+json

.gz
→ application/gzip
```

เพื่อให้ Browser/CDN ทำงานถูกต้อง

---

# 48. Compression

Dataset ขนาดใหญ่ เช่น:

```text
rivers.geojson
drainage.geojson
catchments.geojson
history
```

ควรรองรับ compression เช่น:

```text
gzip
brotli
```

เพื่อลด Bandwidth

แต่ต้องพิจารณาว่า CDN/R2 configuration รองรับการเสิร์ฟไฟล์ compressed อย่างไร

---

# 49. Out of Scope

Backend **ไม่รับผิดชอบการสร้าง**

* DEM
* Watershed
* Catchment
* Drainage Network
* Chain of River
* Rainfall-Runoff Model
* Hydrological Model
* Hydraulic Model
* Forecast Model

แต่ต้องรองรับการเก็บ:

```text
DEM-derived dataset
Watershed
Catchment
Drainage Network
Chain of River
Rainfall-Runoff Output
Forecast
Model Output
```

บน R2 และมี Dataset Registry รองรับ

---

# 50. Final Architecture

ดังนั้น Architecture ที่ผมแนะนำหลังจากแก้ Requirement นี้คือ:

```text
                         ┌─────────────────┐
                         │    ThaiWater    │
                         └────────┬────────┘
                                  │
                               Cronjob
                                  │
                     ┌────────────┴────────────┐
                     │                         │
                     ▼                         ▼
             ┌──────────────┐          ┌──────────────┐
             │ Relational DB│          │     R2       │
             │              │          │ Public Data  │
             │ Basin        │          │              │
             │ Station      │          │ overview     │
             │ Dataset Reg. │          │ stations     │
             │ Config       │          │ current      │
             └───────┬──────┘          │ history      │
                     │                 │ detail       │
                     │                 │ relations    │
                     │                 │ spatial      │
                     │                 │ model        │
                     │                 └──────┬───────┘
                     │                        │
                     ▼                        ▼
                  Backend API             CDN / R2
                     │                        │
                     └────────────┬───────────┘
                                  │
                              Frontend
```

### หลักการสำคัญที่สุด

```text
DB
→ "ระบบมีอะไรบ้าง?"

R2
→ "ข้อมูลที่ Frontend ต้องอ่านคืออะไร?"

API
→ "สิ่งที่ต้องใช้ Logic / Query / Management คืออะไร?"

Cronjob
→ "ข้อมูลจาก ThaiWater เข้ามาอย่างไร?"

Frontend
→ "อ่าน Public Dataset จาก R2 โดยตรง"
```