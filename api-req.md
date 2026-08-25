# Water Situation Platform — Comprehensive API & Data Requirements (`api-req.md`)

> **Version:** 1.1.0  
> **Location:** `water-analysis-frontend/api-req.md`  
> **Scope:** Data formats, JSON Schemas, Units, and Exact Object Paths for Frontend & Backend Integration  
> **Architecture Reference:** `water-analysis-backend/req.md` (Architecture: One Platform + One Backend + Multiple Basins + Public R2 Datasets + REST API)  

---

## 📑 สารบัญ (Table of Contents)

1. [สถาปัตยกรรมข้อมูลหลัก (Core Data Architecture)](#1-สถาปัตยกรรมข้อมูลหลัก-core-data-architecture)
2. [พจนานุกรมข้อมูลและ Enums (Data Types & Enumerations)](#2-พจนานุกรมข้อมูลและ-enums-data-types--enumerations)
3. [โครงสร้าง R2 Public Object Paths Hierarchy](#3-โครงสร้าง-r2-public-object-paths-hierarchy)
4. [ข้อกำหนด R2 Public JSON Datasets ละเอียดสูงสุด](#4-ข้อกำหนด-r2-public-json-datasets-ละเอียดสูงสุด)
   - 4.1 [`/basins.json` (หน้ารวมลุ่มน้ำทั้งประเทศ)](#41-basinsjson-หน้ารวมลุ่มน้ำทั้งประเทศ)
   - 4.2 [`/basin/{basin}/basin.json` (ข้อมูลลุ่มน้ำเฉพาะ)](#42-basinbasinbasinjson-ข้อมูลลุ่มน้ำเฉพาะ)
   - 4.3 [`/basin/{basin}/overview.json` (Dashboard ภาพรวมลุ่มน้ำ)](#43-basinbasinoverviewjson-dashboard-ภาพรวมลุ่มน้ำ)
   - 4.4 [`/basin/{basin}/stations.json` (สารบัญสถานีทั้งหมด + Telemetry Snapshot)](#44-basinbasinstationsjson-สารบัญสถานีทั้งหมด--telemetry-snapshot)
   - 4.5 [`/basin/{basin}/stations/{station_id}/detail.json` (โปรไฟล์สถานีละเอียด)](#45-basinbasinstationsstation_iddetailjson-โปรไฟล์สถานีละเอียด)
   - 4.6 [`/basin/{basin}/stations/{station_id}/current.json` (ข้อมูลโทรมาตรปัจจุบัน)](#46-basinbasinstationsstation_idcurrentjson-ข้อมูลโทรมาตรปัจจุบัน)
   - 4.7 [`/basin/{basin}/stations/{station_id}/history/{YYYY-MM-DD}.json` (โทรมาตรย้อนหลังรายวัน)](#47-basinbasinstationsstation_idhistoryyyyy-mm-ddjson-โทรมาตรย้อนหลังรายวัน)
   - 4.8 [`/basin/{basin}/stations/{station_id}/relations.json` (เครือข่ายความสัมพันธ์สถานี)](#48-basinbasinstationsstation_idrelationsjson-เครือข่ายความสัมพันธ์สถานี)
   - 4.9 [`/basin/{basin}/river/chain.json` (ผังโปรไฟล์แม่น้ำสายหลัก)](#49-basinbasinriverchainjson-ผังโปรไฟล์แม่น้ำสายหลัก)
   - 4.10 [`/basin/{basin}/report/bulletin-latest.json` (รายงานสถานการณ์น้ำทางการ)](#410-basinbasinreportbulletin-latestjson-รายงานสถานการณ์น้ำทางการ)
   - 4.11 [`/basin/{basin}/events/feed.json` (Timeline เหตุการณ์และแจ้งเตือนภัย)](#411-basinbasineventsfeedjson-timeline-เหตุการณ์และแจ้งเตือนภัย)
5. [ข้อกำหนด Spatial Data (GeoJSON Datasets)](#5-ข้อกำหนด-spatial-data-geojson-datasets)
   - 5.1 [`/basin/{basin}/spatial/boundary.geojson` (ขอบเขตลุ่มน้ำ)](#51-basinbasinspatialboundarygeojson-ขอบเขตลุ่มน้ำ)
   - 5.2 [`/basin/{basin}/spatial/rivers.geojson` (โครงข่ายแม่น้ำและลำน้ำสาขา)](#52-basinbasinspatialriversgeojson-โครงข่ายแม่น้ำและลำน้ำสาขา)
   - 5.3 [`/basin/{basin}/spatial/catchments.geojson` (ขอบเขตลุ่มน้ำย่อย)](#53-basinbasinspatialcatchmentsgeojson-ขอบเขตลุ่มน้ำย่อย)
   - 5.4 [`/basin/{basin}/spatial/drainage.geojson` (เครือข่ายลำคลองและการระบายน้ำ)](#54-basinbasinspatialdrainagegeojson-เครือข่ายลำคลองและการระบายน้ำ)
6. [ข้อกำหนด Backend REST API](#6-ข้อกำหนด-backend-rest-api)
   - 6.1 `GET /api/basins`
   - 6.2 `GET /api/basins/{slug}`
   - 6.3 Admin & Cron Trigger APIs
7. [นโยบาย Cache-Control, Compression & Error Handling](#7-นโยบาย-cache-control-compression--error-handling)

---

# 1. สถาปัตยกรรมข้อมูลหลัก (Core Data Architecture)

ระบบใช้สถาปัตยกรรม **One Platform + One Backend + Multiple Basins**:

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
                          API / CDN
                            │
                            ▼
                         Frontend
```

### หลักการสำคัญ
1. **DB (Relational DB)**: เก็บ Master Data / Registry สำหรับ Query เชิงระบบและการจัดการ
2. **R2 (Cloudflare R2 Public Storage)**: เก็บ Public Dataset ในรูปแบบ JSON / GeoJSON สำหรับให้ Frontend โหลดตรงผ่าน CDN โดยไม่ต้องผ่าน API Proxy
3. **API (Backend API)**: ใช้สำหรับงานที่ต้องมี Logic / Dynamic Query / Ingestion Management
4. **Cronjob**: ดึงข้อมูลจาก ThaiWater, ทำ Data Normalization, Data Validation และ Publish ไฟล์ JSON ขึ้น R2 ตามรอบเวลา

---

# 2. พจนานุกรมข้อมูลและ Enums (Data Types & Enumerations)

### 2.1 Localized String (`LocalizedString`)
โครงสร้างภาษาคู่ (ไทย/อังกฤษ) ใช้ในทุกฟิลด์ที่เป็นข้อความแสดงผล:
```typescript
interface LocalizedString {
  th: string; // ภาษาไทย
  en: string; // ภาษาอังกฤษ
}
```

### 2.2 Situation Status (`SituationStatus`)
สถานะความรุนแรงของสถานีและลุ่มน้ำ:
- `"normal"`: ปกติ (ระดับน้ำ < 70% ความจุตลิ่ง / ฝน 24 ชม. < 35 มม.)
- `"watch"`: เฝ้าระวัง (ระดับน้ำ 70% - 85% ตลิ่ง / ฝน 24 ชม. 35 - 90 มม. / น้ำขึ้นเร็ว)
- `"warning"`: เตือนภัย (ระดับน้ำ 85% - 100% ตลิ่ง / ฝน 24 ชม. > 90 มม.)
- `"critical"`: วิกฤต (ระดับน้ำเกิน 100% ล้นตลิ่ง / ฝน 24 ชม. > 150 มม.)
- `"missing"`: ข้อมูลขาดหายหรือไม่ส่งสัญญาณตรวจวัด

### 2.3 Station Type (`StationType`)
- `"water_level"`: สถานีวัดระดับน้ำและอัตราการไหลลำน้ำ
- `"rainfall"`: สถานีวัดปริมาณน้ำฝน

### 2.4 Trend Direction (`TrendDirection`)
- `"rising"`: ระดับน้ำกำลังเพิ่มขึ้น
- `"steady"`: ระดับน้ำทรงตัว
- `"falling"`: ระดับน้ำกำลังลดลง

### 2.5 Rain Intensity (`RainIntensity`)
- `"light"`: ฝนตกเล็กน้อย (< 10.0 มม./24ชม.)
- `"moderate"`: ฝนตกปานกลาง (10.1 - 35.0 มม./24ชม.)
- `"heavy"`: ฝนตกหนัก (35.1 - 90.0 มม./24ชม.)
- `"very_heavy"`: ฝนตกหนักมาก (> 90.0 มม./24ชม.)

### 2.6 Freshness Status (`FreshnessStatus`)
- `"fresh"`: ข้อมูลสดใหม่ (ตรวจวัดภายใน 1 ชั่วโมงล่าสุด)
- `"delayed"`: ข้อมูลล่าช้า (ตรวจวัดระหว่าง 1 - 3 ชั่วโมงที่แล้ว)
- `"missing"`: ข้อมูลขาดหาย (เกิน 3 ชั่วโมงขึ้นไป)

---

# 3. โครงสร้าง R2 Public Object Paths Hierarchy

โครงสร้าง Object บน R2 ถูกจัดสรรตามมาตรฐานใน `water-analysis-backend/req.md`:

```text
/
├── basins.json                                        <-- หน้ารวมลุ่มน้ำทั้งประเทศ
│
└── basin/
    └── {basin}/                                       <-- เช่น yom, nan, ping, chao-phraya
        ├── basin.json                                 <-- ข้อมูลภาพรวมและขอบเขตลุ่มน้ำ
        ├── overview.json                              <-- ข้อมูลสำเร็จรูปสำหรับหน้า Dashboard
        ├── stations.json                              <-- สารบัญสถานีทั้งหมด + Telemetry Snapshot
        │
        ├── stations/
        │   └── {station_id}/                          <-- เช่น Y-0014, 621, P-0004
        │       ├── detail.json                        <-- ข้อมูลสถิติ พิกัด หน่วยงาน ประจำสถานี
        │       ├── current.json                       <-- ข้อมูลโทรมาตรล่าสุดแบบ Real-time
        │       ├── history/
        │       │   ├── latest-1d.json                 <-- ข้อมูลย้อนหลัง 24 ชั่วโมงล่าสุด
        │       │   ├── latest-3d.json                 <-- ข้อมูลย้อนหลัง 3 วันล่าสุด
        │       │   ├── latest-7d.json                 <-- ข้อมูลย้อนหลัง 7 วันล่าสุด
        │       │   └── {YYYY-MM-DD}.json              <-- ข้อมูลย้อนหลังแยกรายวัน (เช่น 2026-08-22.json)
        │       └── relations.json                     <-- เครือข่ายสถานีฝนต้นน้ำ/สถานีน้ำท้ายน้ำ
        │
        ├── river/
        │   └── chain.json                             <-- ผังเรียงลำดับสถานีแม่น้ำสายหลัก (River Chain)
        │
        ├── spatial/
        │   ├── boundary.geojson                       <-- รูปแปลงเส้นรอบวงลุ่มน้ำ
        │   ├── rivers.geojson                         <-- เส้นโครงข่ายลำน้ำสายหลักและสายรอง
        │   ├── catchments.geojson                     <-- แปลงลุ่มน้ำย่อย (Sub-catchments)
        │   └── drainage.geojson                       <-- เครือข่ายลำคลองและคลองระบายน้ำ
        │
        ├── report/
        │   ├── bulletin-latest.json                   <-- รายงานสรุปสถานการณ์น้ำประจำวันฉบับล่าสุด
        │   └── bulletins/
        │       └── {YYYY-MM-DD}.json                  <-- คลังรายงานประจำวันย้อนหลัง
        │
        └── events/
            └── feed.json                              <-- Timeline การแจ้งเตือนและเหตุการณ์ล่าสุด
```

---

# 4. ข้อกำหนด R2 Public JSON Datasets ละเอียดสูงสุด

---

### 4.1 `/basins.json` (หน้ารวมลุ่มน้ำทั้งประเทศ)
- **Path:** `/basins.json`
- **จุดประสงค์:** หน้าแรกของระบบ (`/`) สำหรับแสดงการ์ดลุ่มน้ำหลัก 25 ลุ่มน้ำ
- **รอบการอัปเดต:** ทุก 15 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-08-23T01:30:00+07:00",
  "totalBasins": 25,
  "basins": [
    {
      "id": "yom",
      "code": "08",
      "name": {
        "th": "ลุ่มน้ำยม",
        "en": "Yom River Basin"
      },
      "description": {
        "th": "ครอบคลุมพื้นที่พะเยา แพร่ สุโขทัย พิษณุโลก และพิจิตร",
        "en": "Covers Phayao, Phrae, Sukhothai, Phitsanulok, and Phichit."
      },
      "mainRivers": [
        { "th": "แม่น้ำยม", "en": "Yom River" },
        { "th": "ลำน้ำควร", "en": "Khuan River" }
      ],
      "provinces": [
        { "th": "พะเยา", "en": "Phayao" },
        { "th": "แพร่", "en": "Phrae" },
        { "th": "สุโขทัย", "en": "Sukhothai" },
        { "th": "พิษณุโลก", "en": "Phitsanulok" },
        { "th": "พิจิตร", "en": "Phichit" }
      ],
      "areaKm2": 23616,
      "totalStations": 42,
      "waterLevelStationsCount": 18,
      "rainfallStationsCount": 24,
      "overallStatus": "watch",
      "statusSummary": {
        "watchCount": 4,
        "risingCount": 3,
        "heavyRainCount": 2
      },
      "lastUpdated": "2026-08-23 01:20:00",
      "bgGradient": "from-amber-950/70 via-slate-900/90 to-slate-950",
      "accentColor": "amber",
      "center": [17.5, 100.0],
      "zoom": 8
    },
    {
      "id": "nan",
      "code": "09",
      "name": {
        "th": "ลุ่มน้ำน่าน",
        "en": "Nan River Basin"
      },
      "description": {
        "th": "ครอบคลุมพื้นที่จังหวัดน่าน อุตรดิตถ์ พิษณุโลก และพิจิตร",
        "en": "Covers Nan, Uttaradit, Phitsanulok, and Phichit."
      },
      "mainRivers": [
        { "th": "แม่น้ำน่าน", "en": "Nan River" },
        { "th": "ลำน้ำปาด", "en": "Pad River" }
      ],
      "provinces": [
        { "th": "น่าน", "en": "Nan" },
        { "th": "อุตรดิตถ์", "en": "Uttaradit" }
      ],
      "areaKm2": 34330,
      "totalStations": 38,
      "waterLevelStationsCount": 16,
      "rainfallStationsCount": 22,
      "overallStatus": "normal",
      "statusSummary": {
        "watchCount": 1,
        "risingCount": 0,
        "heavyRainCount": 0
      },
      "lastUpdated": "2026-08-23 01:20:00",
      "bgGradient": "from-emerald-950/70 via-slate-900/90 to-slate-950",
      "accentColor": "emerald",
      "center": [18.2, 100.8],
      "zoom": 8
    }
  ]
}
```

---

### 4.2 `/basin/{basin}/basin.json` (ข้อมูลลุ่มน้ำเฉพาะ)
- **Path:** `/basin/{basin}/basin.json`
- **จุดประสงค์:** เมทาดาทาลุ่มน้ำสำหรับ Layout Header, Navigation และ Breadcrumb
- **รอบการอัปเดต:** ทุก 10 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "id": "yom",
  "code": "08",
  "name": {
    "th": "ลุ่มน้ำยม",
    "en": "Yom River Basin"
  },
  "description": {
    "th": "พื้นที่รับน้ำสำคัญในภาคเหนือตอนล่าง เชื่อมต่อลุ่มน้ำเจ้าพระยา",
    "en": "Key catchment in Lower Northern Thailand connecting to Chao Phraya."
  },
  "mainRivers": [
    { "th": "แม่น้ำยม", "en": "Yom River" }
  ],
  "provinces": [
    { "th": "พะเยา", "en": "Phayao" },
    { "th": "แพร่", "en": "Phrae" },
    { "th": "สุโขทัย", "en": "Sukhothai" },
    { "th": "พิษณุโลก", "en": "Phitsanulok" }
  ],
  "areaKm2": 23616,
  "totalStations": 42,
  "waterLevelStationsCount": 18,
  "rainfallStationsCount": 24,
  "overallStatus": "watch",
  "statusSummary": {
    "watchCount": 4,
    "risingCount": 3,
    "heavyRainCount": 2
  },
  "lastUpdated": "2026-08-23 01:25:00",
  "center": [17.5, 100.0],
  "zoom": 8,
  "updatedAt": "2026-08-23T01:25:00+07:00"
}
```

---

### 4.3 `/basin/{basin}/overview.json` (Dashboard ภาพรวมลุ่มน้ำ)
- **Path:** `/basin/{basin}/overview.json`
- **จุดประสงค์:** สรุปข้อมูลสำเร็จรูปสำหรับหน้า Dashboard (`/basin/$basinSlug`) ให้โหลดเสร็จใน 1 Request
- **รอบการอัปเดต:** ทุก 5 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "basin": "yom",
  "generatedAt": "2026-08-23T01:25:00+07:00",
  "summary": {
    "overallStatus": "watch",
    "totalStations": 42,
    "waterLevelStations": 18,
    "rainfallStations": 24,
    "watchCount": 4,
    "warningCount": 2,
    "criticalCount": 0,
    "risingCount": 3,
    "heavyRainCount": 2
  },
  "topWaterLevels": [
    {
      "stationId": "Y-0014",
      "code": "Y.14",
      "name": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
      "amphoe": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
      "province": { "th": "สุโขทัย", "en": "Sukhothai" },
      "waterLevelMsl": 5.82,
      "bankCapacityPercent": 68.5,
      "discharge": 285.0,
      "trend": "rising",
      "deltaPerHour": 0.24,
      "status": "warning"
    },
    {
      "stationId": "Y-0020",
      "code": "Y.20",
      "name": { "th": "บ้านห้วยสัก", "en": "Ban Huai Sak" },
      "amphoe": { "th": "สอง", "en": "Song" },
      "province": { "th": "แพร่", "en": "Phrae" },
      "waterLevelMsl": 184.20,
      "bankCapacityPercent": 74.0,
      "discharge": 340.0,
      "trend": "rising",
      "deltaPerHour": 0.18,
      "status": "watch"
    }
  ],
  "topRainfalls": [
    {
      "stationId": "P-0004",
      "code": "P.04",
      "name": { "th": "อบต.สะเอียบ", "en": "Sa-iap TAO" },
      "amphoe": { "th": "สอง", "en": "Song" },
      "province": { "th": "แพร่", "en": "Phrae" },
      "rain1h": 42.0,
      "rain3h": 65.0,
      "rain6h": 85.0,
      "rain24h": 124.0,
      "intensity": "very_heavy",
      "status": "critical"
    },
    {
      "stationId": "621",
      "code": "PKTI",
      "name": { "th": "ทต.พรานกระต่าย", "en": "Phran Kratai Sub-district" },
      "amphoe": { "th": "พรานกระต่าย", "en": "Phran Kratai" },
      "province": { "th": "กำแพงเพชร", "en": "Kamphaeng Phet" },
      "rain1h": 31.0,
      "rain3h": 54.0,
      "rain6h": 68.0,
      "rain24h": 88.5,
      "intensity": "heavy",
      "status": "warning"
    }
  ],
  "latestEvents": [
    {
      "id": "alert-rise-Y-0014",
      "type": "rapid_rise",
      "stationCode": "Y.14",
      "severity": "warning",
      "title": {
        "th": "ระดับน้ำเพิ่มขึ้นอย่างรวดเร็ว (+0.24 ม./ชม.)",
        "en": "Rapid Water Level Rise (+0.24 m/h)"
      },
      "timestamp": "2026-08-23 01:15:00",
      "relativeTime": "10 นาทีที่แล้ว"
    }
  ]
}
```

---

### 4.4 `/basin/{basin}/stations.json` (สารบัญสถานีทั้งหมด + Telemetry Snapshot)
- **Path:** `/basin/{basin}/stations.json`
- **จุดประสงค์:** หน้ารายการสถานี (`/station`), หน้าค้นหาใกล้ฉัน (`/nearby`), และหน้าแผนที่ (`/map`)
- **รอบการอัปเดต:** ทุก 5 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "basin": "yom",
  "generatedAt": "2026-08-23T01:25:00+07:00",
  "totalStations": 42,
  "stations": [
    {
      "id": "Y-0014",
      "code": "Y.14",
      "name": {
        "th": "ศรีสัชนาลัย",
        "en": "Si Satchanalai"
      },
      "basinId": "yom",
      "subBasinId": "yom-upper",
      "subBasinName": {
        "th": "แม่น้ำยมตอนบน",
        "en": "Upper Yom River"
      },
      "stationType": "water_level",
      "lat": 17.5186,
      "long": 99.7615,
      "agency": {
        "name": {
          "th": "กรมชลประทาน",
          "en": "Royal Irrigation Department"
        },
        "shortname": {
          "th": "RID",
          "en": "RID"
        }
      },
      "geocode": {
        "tumbon": { "th": "หาดเสี้ยว", "en": "Hat Siao" },
        "amphoe": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
        "province": { "th": "สุโขทัย", "en": "Sukhothai" },
        "provinceCode": "64",
        "warningZone": "Zone 2"
      },
      "status": "warning",
      "freshness": "fresh",
      "lastUpdated": "2026-08-23 01:20:00",
      "waterLevel": {
        "waterLevelMsl": 5.82,
        "waterLevelBed": 4.12,
        "discharge": 285.0,
        "bankLevelMsl": 8.50,
        "warningLevelMsl": 7.00,
        "criticalLevelMsl": 8.00,
        "bedLevelMsl": 1.70,
        "bankCapacityPercent": 68.5,
        "maxDischargeCapacity": 450.0,
        "dischargePercent": 63.3,
        "trend": "rising",
        "deltaPerHour": 0.24
      },
      "riverOrder": 4,
      "riverName": {
        "th": "แม่น้ำยม",
        "en": "Yom River"
      }
    },
    {
      "id": "621",
      "code": "PKTI",
      "name": {
        "th": "ทต.พรานกระต่าย",
        "en": "Phran Kratai"
      },
      "basinId": "yom",
      "stationType": "rainfall",
      "lat": 16.6537,
      "long": 99.5757,
      "agency": {
        "name": {
          "th": "สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน)",
          "en": "Hydro-Informatics Institute"
        },
        "shortname": {
          "th": "HII",
          "en": "HII"
        }
      },
      "geocode": {
        "tumbon": { "th": "พรานกระต่าย", "en": "Phran Kratai" },
        "amphoe": { "th": "พรานกระต่าย", "en": "Phran Kratai" },
        "province": { "th": "กำแพงเพชร", "en": "Kamphaeng Phet" },
        "provinceCode": "62"
      },
      "status": "warning",
      "freshness": "fresh",
      "lastUpdated": "2026-08-23 01:20:00",
      "rainfall": {
        "rain1h": 31.0,
        "rain3h": 54.0,
        "rain6h": 68.0,
        "rain24h": 88.5,
        "intensity": "heavy"
      }
    }
  ]
}
```

---

### 4.5 `/basin/{basin}/stations/{station_id}/detail.json` (โปรไฟล์สถานีละเอียด)
- **Path:** `/basin/{basin}/stations/{station_id}/detail.json`
- **จุดประสงค์:** หน้ารายละเอียดสถานี (`StationDetailPage.tsx`)
- **รอบการอัปเดต:** ทุก 1 ชั่วโมง หรือเมื่อแก้ไข Master Data
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "station": {
    "id": "Y-0014",
    "code": "Y.14",
    "name": {
      "th": "ศรีสัชนาลัย",
      "en": "Si Satchanalai"
    },
    "basinId": "yom",
    "stationType": "water_level",
    "lat": 17.5186,
    "long": 99.7615,
    "elevationMsl": 55.40,
    "catchmentAreaKm2": 12650.0,
    "agency": {
      "name": {
        "th": "กรมชลประทาน",
        "en": "Royal Irrigation Department"
      },
      "shortname": {
        "th": "RID",
        "en": "RID"
      }
    },
    "geocode": {
      "tumbon": { "th": "หาดเสี้ยว", "en": "Hat Siao" },
      "amphoe": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
      "province": { "th": "สุโขทัย", "en": "Sukhothai" },
      "provinceCode": "64",
      "warningZone": "Zone 2"
    },
    "hydraulicSpec": {
      "bedLevelMsl": 1.70,
      "warningLevelMsl": 7.00,
      "criticalLevelMsl": 8.00,
      "bankLevelMsl": 8.50,
      "maxDischargeCapacity": 450.0
    },
    "river": {
      "name": { "th": "แม่น้ำยม", "en": "Yom River" },
      "chainOrder": 4,
      "distanceFromOriginKm": 182.4
    }
  },
  "updatedAt": "2026-08-23T01:00:00+07:00"
}
```

---

### 4.6 `/basin/{basin}/stations/{station_id}/current.json` (ข้อมูลโทรมาตรปัจจุบัน)
- **Path:** `/basin/{basin}/stations/{station_id}/current.json`
- **จุดประสงค์:** ดึงค่าโทรมาตรสดเดี่ยวสำหรับสถานีที่ระบุ
- **รอบการอัปเดต:** ทุก 5 นาที

#### ตัวอย่าง 1: สถานีวัดระดับน้ำ (`stationType: "water_level"`)
```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "stationType": "water_level",
  "timestamp": "2026-08-23T01:20:00+07:00",
  "status": "warning",
  "freshness": "fresh",
  "data": {
    "waterLevelMsl": 5.82,
    "waterLevelBed": 4.12,
    "discharge": 285.0,
    "bankCapacityPercent": 68.5,
    "marginToBankMsl": 2.68,
    "maxDischargeCapacity": 450.0,
    "dischargePercent": 63.3,
    "trend": "rising",
    "deltaPerHour": 0.24
  }
}
```

#### ตัวอย่าง 2: สถานีวัดปริมาณน้ำฝน (`stationType: "rainfall"`)
```json
{
  "schemaVersion": "1.0",
  "stationId": "621",
  "stationType": "rainfall",
  "timestamp": "2026-08-23T01:20:00+07:00",
  "status": "warning",
  "freshness": "fresh",
  "data": {
    "rain1h": 31.0,
    "rain3h": 54.0,
    "rain6h": 68.0,
    "rain24h": 88.5,
    "intensity": "heavy"
  }
}
```

---

### 4.7 `/basin/{basin}/stations/{station_id}/history/{YYYY-MM-DD}.json` (โทรมาตรย้อนหลังรายวัน)
- **Path:** 
  - รายวันย้อนหลัง: `/basin/{basin}/stations/{station_id}/history/{YYYY-MM-DD}.json` (เช่น `2026-08-22.json`)
  - ช่วงเวลาสำเร็จรูป: `/basin/{basin}/stations/{station_id}/history/latest-1d.json`, `latest-3d.json`, `latest-7d.json`
- **จุดประสงค์:** กราฟย้อนหลังในหน้า Station Detail (`HistoricalChart.tsx`)
- **กฎสำคัญ:**
  - เมื่อเซ็นเซอร์ขัดข้อง ให้ระบุค่าตัวเลขเป็น `null` และใส่ `"isDataGap": true` (ระบบ UI จะไม่ลากเส้นเชื่อมต่อข้อมูลอัตโนมัติ เพื่อรักษาความถูกต้องของข้อมูลอุทกวิทยาตามมาตรฐาน)
  - มีอาเรย์ `dataGaps` ระบุช่วงเวลาและสาเหตุ เพื่อให้ UI แสดงแบนเนอร์แจ้งเตือน Data Gap
- **รอบการอัปเดต:** ทุก 10 นาทีสำหรับวันปัจจุบัน

#### ตัวอย่าง 1: ประวัติสถานีวัดระดับน้ำ (`stationType: "water_level"`)
```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "stationType": "water_level",
  "date": "2026-08-22",
  "timeRange": "1d",
  "summary": {
    "minWaterLevel": 5.10,
    "maxWaterLevel": 5.82,
    "avgWaterLevel": 5.46,
    "maxDischarge": 285.0
  },
  "dataGaps": [
    {
      "startTime": "14:00",
      "endTime": "16:00",
      "durationHours": 2,
      "description": "เซ็นเซอร์คลื่นความถี่ขัดข้องชั่วคราว"
    }
  ],
  "observations": [
    {
      "timestamp": "2026-08-22 13:00:00",
      "displayTime": "13:00",
      "waterLevelMsl": 5.45,
      "waterLevelBed": 3.75,
      "discharge": 250.0,
      "bankCapacityPercent": 64.1,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 14:00:00",
      "displayTime": "14:00",
      "waterLevelMsl": null,
      "waterLevelBed": null,
      "discharge": null,
      "bankCapacityPercent": null,
      "status": "missing",
      "isDataGap": true
    },
    {
      "timestamp": "2026-08-22 15:00:00",
      "displayTime": "15:00",
      "waterLevelMsl": null,
      "waterLevelBed": null,
      "discharge": null,
      "bankCapacityPercent": null,
      "status": "missing",
      "isDataGap": true
    },
    {
      "timestamp": "2026-08-22 16:00:00",
      "displayTime": "16:00",
      "waterLevelMsl": 5.60,
      "waterLevelBed": 3.90,
      "discharge": 268.0,
      "bankCapacityPercent": 65.9,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 17:00:00",
      "displayTime": "17:00",
      "waterLevelMsl": 5.72,
      "waterLevelBed": 4.02,
      "discharge": 278.0,
      "bankCapacityPercent": 67.3,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 18:00:00",
      "displayTime": "18:00",
      "waterLevelMsl": 5.82,
      "waterLevelBed": 4.12,
      "discharge": 285.0,
      "bankCapacityPercent": 68.5,
      "status": "valid",
      "isDataGap": false
    }
  ]
}
```

#### ตัวอย่าง 2: ประวัติสถานีวัดปริมาณน้ำฝน (`stationType: "rainfall"`)
```json
{
  "schemaVersion": "1.0",
  "stationId": "P-0004",
  "stationType": "rainfall",
  "date": "2026-08-22",
  "timeRange": "1d",
  "summary": {
    "totalRainfall": 124.0,
    "maxRain1h": 42.0
  },
  "dataGaps": [],
  "observations": [
    {
      "timestamp": "2026-08-22 15:00:00",
      "displayTime": "15:00",
      "rainfall": 15.0,
      "rainfallCumulative": 72.0,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 16:00:00",
      "displayTime": "16:00",
      "rainfall": 22.0,
      "rainfallCumulative": 94.0,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 17:00:00",
      "displayTime": "17:00",
      "rainfall": 30.0,
      "rainfallCumulative": 124.0,
      "status": "valid",
      "isDataGap": false
    },
    {
      "timestamp": "2026-08-22 18:00:00",
      "displayTime": "18:00",
      "rainfall": 0.0,
      "rainfallCumulative": 124.0,
      "status": "valid",
      "isDataGap": false
    }
  ]
}
```

---

### 4.8 `/basin/{basin}/stations/{station_id}/relations.json` (เครือข่ายความสัมพันธ์สถานี)
- **Path:** `/basin/{basin}/stations/{station_id}/relations.json`
- **จุดประสงค์:** เครือข่ายสถานีฝนต้นน้ำ (Upstream Influence) และสถานีน้ำท้ายน้ำ (Downstream Impact) ใน `StationRelations.tsx`
- **รอบการอัปเดต:** ทุก 15 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "stationId": "Y-0014",
  "generatedAt": "2026-08-23T01:25:00+07:00",
  "relations": [
    {
      "type": "rainfall_influence",
      "stationId": "P-0004",
      "targetStationId": "P-0004",
      "name": {
        "th": "อบต.สะเอียบ",
        "en": "Sa-iap TAO"
      },
      "targetStationName": {
        "th": "อบต.สะเอียบ",
        "en": "Sa-iap TAO"
      },
      "stationType": "rainfall",
      "distanceKm": 48.2,
      "travelTimeHours": 6.5,
      "influenceWeightPercent": 45,
      "latestValue": "124.0 มม.",
      "status": "critical",
      "isUpstream": true
    },
    {
      "type": "rainfall_influence",
      "stationId": "621",
      "targetStationId": "621",
      "name": {
        "th": "ทต.พรานกระต่าย",
        "en": "Phran Kratai"
      },
      "targetStationName": {
        "th": "ทต.พรานกระต่าย",
        "en": "Phran Kratai"
      },
      "stationType": "rainfall",
      "distanceKm": 32.0,
      "travelTimeHours": 4.0,
      "influenceWeightPercent": 30,
      "latestValue": "88.5 มม.",
      "status": "warning",
      "isUpstream": true
    },
    {
      "type": "downstream_gauge",
      "stationId": "Y-0003A",
      "targetStationId": "Y-0003A",
      "name": {
        "th": "เมืองสุโขทัย (Y.3A)",
        "en": "Mueang Sukhothai"
      },
      "targetStationName": {
        "th": "เมืองสุโขทัย (Y.3A)",
        "en": "Mueang Sukhothai"
      },
      "stationType": "water_level",
      "distanceKm": 54.0,
      "travelTimeHours": 8.0,
      "latestValue": "50.15 ม.รทก.",
      "status": "watch",
      "isUpstream": false
    }
  ]
}
```

---

### 4.9 `/basin/{basin}/river/chain.json` (ผังโปรไฟล์แม่น้ำสายหลัก)
- **Path:** `/basin/{basin}/river/chain.json`
- **จุดประสงค์:** แสดงผังโปรไฟล์การไหลของน้ำตั้งแต่ต้นน้ำถึงท้ายน้ำ (`RiverChainView.tsx`)
- **รอบการอัปเดต:** ทุก 10 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "river": "yom",
  "riverName": {
    "th": "แม่น้ำยม",
    "en": "Yom River"
  },
  "generatedAt": "2026-08-23T01:25:00+07:00",
  "stations": [
    {
      "stationId": "Y-0020",
      "code": "Y.20",
      "name": { "th": "บ้านห้วยสัก (ต้นน้ำ)", "en": "Ban Huai Sak" },
      "amphoe": { "th": "สอง", "en": "Song" },
      "province": { "th": "แพร่", "en": "Phrae" },
      "riverOrder": 1,
      "waterLevelMsl": 184.20,
      "bankCapacityPercent": 74.0,
      "discharge": 340.0,
      "trend": "rising",
      "status": "watch"
    },
    {
      "stationId": "Y-0001C",
      "code": "Y.1C",
      "name": { "th": "บ้านน้ำโค้ง (กลางน้ำ)", "en": "Ban Nam Khong" },
      "amphoe": { "th": "เมืองแพร่", "en": "Mueang Phrae" },
      "province": { "th": "แพร่", "en": "Phrae" },
      "riverOrder": 2,
      "waterLevelMsl": 153.80,
      "bankCapacityPercent": 71.5,
      "discharge": 420.0,
      "trend": "rising",
      "status": "watch"
    },
    {
      "stationId": "Y-0014",
      "code": "Y.14",
      "name": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
      "amphoe": { "th": "ศรีสัชนาลัย", "en": "Si Satchanalai" },
      "province": { "th": "สุโขทัย", "en": "Sukhothai" },
      "riverOrder": 3,
      "waterLevelMsl": 5.82,
      "bankCapacityPercent": 68.5,
      "discharge": 285.0,
      "trend": "rising",
      "status": "warning"
    },
    {
      "stationId": "Y-0003A",
      "code": "Y.3A",
      "name": { "th": "เมืองสุโขทัย", "en": "Mueang Sukhothai" },
      "amphoe": { "th": "เมืองสุโขทัย", "en": "Mueang Sukhothai" },
      "province": { "th": "สุโขทัย", "en": "Sukhothai" },
      "riverOrder": 4,
      "waterLevelMsl": 50.15,
      "bankCapacityPercent": 72.0,
      "discharge": 310.0,
      "trend": "steady",
      "status": "watch"
    },
    {
      "stationId": "Y-0006",
      "code": "Y.6",
      "name": { "th": "บางระกำ (ปลายน้ำ)", "en": "Bang Rakam" },
      "amphoe": { "th": "บางระกำ", "en": "Bang Rakam" },
      "province": { "th": "พิษณุโลก", "en": "Phitsanulok" },
      "riverOrder": 5,
      "waterLevelMsl": 41.20,
      "bankCapacityPercent": 55.0,
      "discharge": 240.0,
      "trend": "steady",
      "status": "normal"
    }
  ]
}
```

---

### 4.10 `/basin/{basin}/report/bulletin-latest.json` (รายงานสถานการณ์น้ำทางการ)
- **Path:** `/basin/{basin}/report/bulletin-latest.json`
- **จุดประสงค์:** รายงานสรุปสถานการณ์น้ำประจำวันฉบับทางการ (`DailyBulletin.tsx`) รองรับ Print to PDF
- **รอบการอัปเดต:** วันละ 2-4 รอบ (เช่น 06:00, 12:00, 18:00 น.)
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "id": "bulletin-yom-20260822-1800",
  "basinId": "yom",
  "basinName": {
    "th": "ลุ่มน้ำยม",
    "en": "Yom River Basin"
  },
  "issuedDate": "22 สิงหาคม 2569",
  "issuedTime": "18:00 น.",
  "overallSituation": {
    "th": "สถานการณ์น้ำอยู่ในเกณฑ์เฝ้าระวัง มีฝนตกหนักบริเวณต้นน้ำ ส่งผลให้ปริมาณน้ำท่าในลำน้ำสายหลักมีแนวโน้มเพิ่มขึ้นต่อเนื่อง",
    "en": "Water situation is currently on WATCH status due to heavy upstream rainfall, causing rising water levels across the main river."
  },
  "overallSeverity": "watch",
  "keyHighlights": [
    {
      "th": "สถานี Y.14 อ.ศรีสัชนาลัย ระดับน้ำ 5.82 ม.รทก. คิดเป็น 68.5% ของตลิ่ง มีแนวโน้มเพิ่มขึ้นต่อเนื่องในอัตรา 0.24 ม./ชม.",
      "en": "Station Y.14 (Si Satchanalai) water level at 5.82 m MSL (68.5% bank capacity), rising at +0.24 m/h."
    },
    {
      "th": "สถานีฝน P.04 อบต.สะเอียบ อ.สอง จ.แพร่ มีฝนตกหนักสะสม 24 ชม. สูงถึง 124.0 มม. ให้เฝ้าระวังมวลน้ำหลากที่จะไหลลงสู่สุโขทัยในอีก 6-8 ชม.",
      "en": "Rainfall station P.04 (Sa-iap, Phrae) recorded 124.0 mm 24h rainfall. Downstream runoff will reach Sukhothai in 6-8 hours."
    },
    {
      "th": "ทุ่งรับน้ำบางระกำโมเดล พร้อมเปิดประตูระบายน้ำผันน้ำส่วนเกินเพื่อลดผลกระทบพื้นที่เศรษฐกิจสุโขทัย-พิษณุโลก",
      "en": "Bang Rakam flood detention basin is ready to divert excess water flow to protect urban economic zones."
    }
  ],
  "highRiskAreas": [
    { "th": "อ.สอง, อ.เมือง จ.แพร่", "en": "Song, Mueang Districts (Phrae)" },
    { "th": "อ.ศรีสัชนาลัย, อ.สวรรคโลก, อ.เมือง จ.สุโขทัย", "en": "Si Satchanalai, Sawankhalok, Mueang Districts (Sukhothai)" },
    { "th": "อ.บางระกำ, อ.พรหมพิราม จ.พิษณุโลก", "en": "Bang Rakam, Phrom Phiram Districts (Phitsanulok)" }
  ],
  "upstreamStatus": {
    "th": "ต้นน้ำยม จ.พะเยา และ อ.สอง จ.แพร่ มีฝนตกหนัก ปริมาณน้ำในลำน้ำสาขาเพิ่มขึ้นอย่างรวดเร็ว",
    "en": "Upstream Yom in Phayao and Song district (Phrae) experiencing heavy rains with rapid tributary rise."
  },
  "midstreamStatus": {
    "th": "กลางน้ำ อ.ศรีสัชนาลัย และ อ.เมือง สุโขทัย ระดับน้ำทรงตัวสูง อยู่ในเกณฑ์เฝ้าระวังใกล้ชิด",
    "en": "Midstream in Si Satchanalai and Mueang Sukhothai remains high under close surveillance."
  },
  "downstreamStatus": {
    "th": "ปลายน้ำ อ.บางระกำ จ.พิษณุโลก ระดับน้ำยังต่ำกว่าตลิ่ง 3.80 เมตร ประตูระบายน้ำพร้อมเปิดรับน้ำเข้าทุ่ง",
    "en": "Downstream in Bang Rakam is 3.80m below bank level, ready for flood diversion intake."
  },
  "forecastNext24h": {
    "th": "คาดว่ามวลน้ำจากตอนบนจะไหลผ่าน อ.ศรีสัชนาลัย สูงสุดในคืนนี้เวลาประมาณ 23:00 น. ระดับน้ำอาจเพิ่มขึ้นอีก 0.30 - 0.50 เมตร",
    "en": "Peak discharge from upstream is expected to pass Si Satchanalai tonight around 23:00, with an estimated rise of 0.30 - 0.50m."
  },
  "officerInCharge": {
    "th": "ศูนย์ประมวลวิเคราะห์สถานการณ์น้ำ — Korarit Saengthong",
    "en": "Water Situation Analysis Center — Korarit Saengthong"
  }
}
```

---

### 4.11 `/basin/{basin}/events/feed.json` (Timeline เหตุการณ์และแจ้งเตือนภัย)
- **Path:** `/basin/{basin}/events/feed.json`
- **จุดประสงค์:** หน้ากระดานแจ้งเตือนภัย (`EventsAndAlertsPage.tsx`) และฟีดเหตุการณ์ในหน้าหลัก
- **รอบการอัปเดต:** ทุก 3 นาที
- **JSON Schema & Example:**

```json
{
  "schemaVersion": "1.0",
  "basin": "yom",
  "generatedAt": "2026-08-23T01:25:00+07:00",
  "events": [
    {
      "id": "alert-rise-Y-0014-202608230115",
      "type": "rapid_rise",
      "stationId": "Y-0014",
      "stationCode": "Y.14",
      "stationName": {
        "th": "ศรีสัชนาลัย",
        "en": "Si Satchanalai"
      },
      "basinId": "yom",
      "basinName": {
        "th": "ลุ่มน้ำยม",
        "en": "Yom Basin"
      },
      "severity": "warning",
      "title": {
        "th": "ระดับน้ำเพิ่มขึ้นอย่างรวดเร็ว (+0.24 ม./ชม.)",
        "en": "Rapid Water Level Rise (+0.24 m/h)"
      },
      "description": {
        "th": "ตรวจพบอัตราการเพิ่มของระดับน้ำสูงผิดปกติที่สถานี Y.14 (ศรีสัชนาลัย) อ.ศรีสัชนาลัย จ.สุโขทัย",
        "en": "Abnormal rapid rise detected at station Y.14 (Si Satchanalai), Sukhothai."
      },
      "ruleTriggered": {
        "th": "กฎเตือนภัย: อัตราการเพิ่มระดับน้ำ > 0.20 ม./ชม. ติดต่อกัน",
        "en": "Alert Rule: Water level rise rate > 0.20 m/h consecutively"
      },
      "value": "+0.24 ม./ชม.",
      "threshold": "> 0.20 ม./ชม.",
      "timestamp": "2026-08-23 01:15:00",
      "relativeTime": "10 นาทีที่แล้ว"
    },
    {
      "id": "alert-rain-P-0004-202608230100",
      "type": "heavy_rain",
      "stationId": "P-0004",
      "stationCode": "P.04",
      "stationName": {
        "th": "อบต.สะเอียบ",
        "en": "Sa-iap TAO"
      },
      "basinId": "yom",
      "basinName": {
        "th": "ลุ่มน้ำยม",
        "en": "Yom Basin"
      },
      "severity": "critical",
      "title": {
        "th": "ฝนตกหนักมากในพื้นที่ (42.0 มม./ชม.)",
        "en": "Intense Rainfall Detected (42.0 mm/h)"
      },
      "description": {
        "th": "ปริมาณฝนสะสมสูงที่สถานี P.04 (สะเอียบ) ฝน 24 ชม. สะสม 124.0 มม. มีความเสี่ยงน้ำป่าไหลหลาก",
        "en": "Heavy rainfall detected at P.04 with 24h accumulation 124.0 mm. Flash flood risk elevated."
      },
      "ruleTriggered": {
        "th": "กฎเตือนภัย: ฝน 1 ชม. > 30 มม. หรือ ฝน 24 ชม. > 80 มม.",
        "en": "Alert Rule: 1h Rain > 30mm or 24h Rain > 80mm"
      },
      "value": "42.0 มม.",
      "threshold": "> 30 มม.",
      "timestamp": "2026-08-23 01:00:00",
      "relativeTime": "25 นาทีที่แล้ว"
    }
  ]
}
```

---

# 5. ข้อกำหนด Spatial Data (GeoJSON Datasets)

ไฟล์ GeoJSON ทั้งหมดต้องเป็นมาตรฐาน **RFC 7946** พิกัด **WGS 84 (EPSG:4326)**

### 5.1 `/basin/{basin}/spatial/boundary.geojson` (ขอบเขตลุ่มน้ำ)
- **Path:** `/basin/{basin}/spatial/boundary.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "basinId": "yom",
        "nameTh": "ลุ่มน้ำยม",
        "nameEn": "Yom River Basin",
        "areaKm2": 23616
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [99.85, 19.12],
            [100.35, 18.75],
            [100.42, 17.82],
            [99.98, 16.45],
            [99.45, 17.15],
            [99.85, 19.12]
          ]
        ]
      }
    }
  ]
}
```

### 5.2 `/basin/{basin}/spatial/rivers.geojson` (โครงข่ายแม่น้ำและลำน้ำสาขา)
- **Path:** `/basin/{basin}/spatial/rivers.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "riverId": "R-YOM-01",
        "nameTh": "แม่น้ำยม (สายหลัก)",
        "nameEn": "Yom Main River",
        "order": 1,
        "lengthKm": 735.0
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [100.25, 19.05],
          [100.18, 18.45],
          [100.14, 18.14],
          [99.76, 17.51],
          [99.82, 17.00],
          [100.11, 16.75]
        ]
      }
    }
  ]
}
```

### 5.3 `/basin/{basin}/spatial/catchments.geojson` (ขอบเขตลุ่มน้ำย่อย)
- **Path:** `/basin/{basin}/spatial/catchments.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "subBasinId": "yom-upper",
        "nameTh": "ลุ่มน้ำยมตอนบน",
        "nameEn": "Upper Yom Catchment",
        "areaKm2": 7240.0
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [99.85, 19.12],
            [100.35, 18.75],
            [99.76, 17.51],
            [99.45, 17.15],
            [99.85, 19.12]
          ]
        ]
      }
    }
  ]
}
```

### 5.4 `/basin/{basin}/spatial/drainage.geojson` (เครือข่ายลำคลองและการระบายน้ำ)
- **Path:** `/basin/{basin}/spatial/drainage.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "canalId": "C-YOM-01",
        "nameTh": "คลองหกบาท",
        "nameEn": "Hok Bat Canal",
        "capacityCms": 250.0
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [99.81, 17.32],
          [99.95, 17.20]
        ]
      }
    }
  ]
}
```

---

# 6. ข้อกำหนด Backend REST API

API สำหรับงานประมวลผล / Dynamic Query / การจัดการ (อ้างอิง Section 25 ใน `water-analysis-backend/req.md`):

### 6.1 `GET /api/basins`
- **Method:** `GET`
- **Path:** `/api/basins`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "yom",
      "code": "08",
      "name": { "th": "ลุ่มน้ำยม", "en": "Yom River Basin" },
      "totalStations": 42,
      "overallStatus": "watch",
      "lastUpdated": "2026-08-23T01:25:00+07:00"
    }
  ]
}
```

### 6.2 `GET /api/basins/{slug}`
- **Method:** `GET`
- **Path:** `/api/basins/{slug}`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "yom",
    "code": "08",
    "name": { "th": "ลุ่มน้ำยม", "en": "Yom River Basin" },
    "description": { "th": "...", "en": "..." },
    "areaKm2": 23616,
    "totalStations": 42,
    "waterLevelStationsCount": 18,
    "rainfallStationsCount": 24,
    "overallStatus": "watch",
    "statusSummary": {
      "watchCount": 4,
      "risingCount": 3,
      "heavyRainCount": 2
    }
  }
}
```

### 6.3 Internal / Admin Synchronization APIs
```http
POST /api/admin/sync/stations
POST /api/admin/sync/observations
POST /api/admin/datasets/rebuild
```

---

# 7. นโยบาย Cache-Control, Compression & Error Handling

### 7.1 HTTP Cache-Control Headers บน Cloudflare R2 / CDN

| Dataset Path | Cache-Control Header | เหตุผล |
| :--- | :--- | :--- |
| `/basins.json` | `public, max-age=600, s-maxage=600` | อัปเดตทุก 10 นาที |
| `/basin/{slug}/overview.json` | `public, max-age=120, s-maxage=120` | Real-time Dashboard Snapshot |
| `/basin/{slug}/stations.json` | `public, max-age=180, s-maxage=180` | Real-time Station Snapshot |
| `/basin/{slug}/stations/{id}/current.json` | `public, max-age=60, s-maxage=60` | ข้อมูลสด อัปเดตบ่อย |
| `/basin/{slug}/stations/{id}/detail.json` | `public, max-age=86400, s-maxage=86400` | ข้อมูลสถิติ นานๆ เปลี่ยนที |
| `/basin/{slug}/stations/{id}/history/{date}.json` | `public, max-age=600, s-maxage=600` (วันปัจจุบัน) / `public, max-age=604800` (วันในอดีต) | อดีตเป็น Immutable cache |
| `/basin/{slug}/spatial/*.geojson` | `public, max-age=604800, s-maxage=604800` | ข้อมูลแผนที่ภูมิศาสตร์คงที่ |
| `/basin/{slug}/report/bulletin-latest.json` | `public, max-age=600, s-maxage=600` | รายงานทางการ |

### 7.2 Compression
ไฟล์ GeoJSON และ Historical JSON ที่มีขนาดเกิน 10 KB ต้องเสิร์ฟด้วย **Gzip / Brotli encoding** (`Content-Encoding: gzip` หรือ `br`)

### 7.3 Atomic Update & Stale Recovery Strategy
1. **Atomic Publishing**: Cronjob ต้องเขียนข้อมูลไปยังไฟล์ชั่วคราว (`.tmp.json`) ตรวจสอบความถูกต้องของ JSON Schema แล้วจึงทำการ Replace ไปยัง Path จริง เพื่อป้องกัน Frontend อ่านไฟล์ขณะเขียนไม่เสร็จ
2. **Stale Data Fallback**: หาก API ต้นทาง (ThaiWater) ไม่สามารถเชื่อมต่อได้ในรอบ Sync นั้น **ห้ามลบ Object เดิมทิ้ง** ให้คงค่าเดิมไว้และปรับฟิลด์ `"freshness": "delayed"` หรือ `"missing"` เพื่อให้ผู้ใช้งานยังเห็นข้อมูลเดิมและทราบสถานะความล่าช้า
