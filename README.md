# 🌊 Flood Analysis Backend (Water Situation Platform)

[![Bun](https://img.shields.io/badge/Bun-1.4+-fbf0df?style=flat&logo=bun&logoColor=black)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4.13-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare_R2-S3_Compatible-F38020?style=flat&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/products/r2/)

**Flood Analysis Backend** คือระบบหลังบ้านประสิทธิภาพสูงสำหรับรวบรวมข้อมูลโทรมาตรน้ำ (Telemetry Ingestion), ประมวลผลและวิเคราะห์ข้อมูลสถานการณ์น้ำท่วมและน้ำหลากแบบหลายลุ่มน้ำ (Multi-Basin) พร้อมสถาปัตยกรรม **R2 Static CDN Read Layer** โดย Frontend อ่านข้อมูล JSON / GeoJSON จาก Cloudflare R2 โดยตรง 100% ทำให้ระบบรองรับการเข้าชมพร้อมกันจำนวนมหาศาลได้อย่างรวดเร็วและไม่สร้างโหลดต่อฐานข้อมูลหลัก

---

## 🏛️ สถาปัตยกรรมระบบ (System Architecture)

ระบบออกแบบตามแนวคิด **Decoupled Architecture (Database Write & Ingest + R2 CDN Read Layer)**:

```text
┌──────────────────────────────────────────────┐
│  ThaiWater Public API / Dataset Files        │
│  (_waterlevel_stations, _rain_stations,     │
│   relations_frontend.json, GeoJSON)          │
└──────────────────────┬───────────────────────┘
                       │ Cron Ingestion & Upload APIs
                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Flood Analysis Backend (Bun + Hono)                  │
│                                                                        │
│  ┌─────────────────────────────────┐   ┌────────────────────────────┐  │
│  │    PostgreSQL (Drizzle ORM)     │   │    R2 Publisher Engine     │  │
│  │  - basins (is_active, path)     │──▶│  - JSON & GeoJSON Generator│  │
│  │  - waterlevel_stations (meta)   │   │  - Batch Preloaded Cache   │  │
│  │  - rainfall_stations (meta)     │   └─────────────┬──────────────┘  │
│  │  - station_relations (graph)    │                 │                 │
│  │  - telemetry_latest / history   │                 │                 │
│  └─────────────────────────────────┘                 │                 │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       │
                                     ┌─────────────────┴─────────────────┐
                                     ▼ (100% Static Read Layer)          ▼ (Admin / Management)
                       ┌───────────────────────────┐       ┌───────────────────────────┐
                       │    Cloudflare R2 Bucket   │       │     Backend REST APIs     │
                       │     (Public CDN Mirror)   │       │   - /api/admin/* (Upload) │
                       │                           │       │   - /api/cron/* (Sync)    │
                       │  waterlevel_station/      │       │   - /api/basins           │
                       │    {basin}/stations.json  │       │   - /api/stations         │
                       │    {basin}/{id}/detail    │       └───────────────────────────┘
                       │    {basin}/{id}/relations │
                       │    {basin}/{id}/current   │
                       │                           │
                       │  rainfall_station/        │
                       │    {basin}/stations.json  │
                       │    {basin}/{id}/detail    │
                       │    {basin}/{id}/relations │
                       │    {basin}/{id}/current   │
                       │                           │
                       │  basin/                   │
                       │    {basin}/overview.json  │
                       │    {basin}/spatial/*.json │
                       │                           │
                       │  basins.json              │
                       └─────────────┬─────────────┘
                                     │
                                     ▼
                       ┌───────────────────────────┐
                       │  Flood Analysis Frontend  │
                       │ (React + TanStack Router) │
                       │     * Reads 100% R2 *     │
                       └───────────────────────────┘
```

---

## ✨ คุณสมบัติเด่น (Key Features)

1. **Frontend อ่านข้อมูลผ่าน Cloudflare R2 โดยตรง 100% (CDN Read Layer)**:
   - ลด Latency เหลือระดับมิลลิวินาทีด้วย Cloudflare Edge CDN
   - โครงสร้างโฟลเดอร์แยกหมวดหมู่ชัดเจน: `waterlevel_station/{basin}/` และ `rainfall_station/{basin}/`
2. **ฐานข้อมูลแยกตารางอิสระ (Separated Normalized Schemas)**:
   - ตาราง `waterlevel_stations` และ `rainfall_stations` เก็บข้อมูลสถานีและ Rich Metadata แยกกัน
   - ตาราง `basins` รองรับการเปิด/ปิดลุ่มน้ำผ่านฟิลด์ `is_active` (`true`/`false`)
   - เก็บที่อยู่ไฟล์ GeoJSON ขอบเขตลุ่มน้ำผ่าน `boundary_geojson_path` (ไม่เก็บ BBox สี่เหลี่ยมใน DB เพื่อความ Lean)
3. **ระบบความสัมพันธ์ชลศาสตร์ 2 ทิศทาง (Bidirectional Relations & Stream Fall)**:
   - นำเข้าจาก `relations_frontend.json`:
     - **สถานีวัดน้ำ (Waterlevel)**: บันทึก `influencingRainfallStations` (พร้อมเกณฑ์ฝนวิกฤต 4 ช่วงเวลา: 3h, 24h, 72h, 168h) และ `streamFall` (สถานีรับน้ำถัดไปตามลำน้ำ)
     - **สถานีฝน (Rainfall)**: ทำ Inverted Index อัตโนมัติเป็น `receivingWaterlevelStations` (ระบุสถานีวัดระดับน้ำที่รับน้ำจากสถานีฝนนี้)
4. **การจัดการลุ่มน้ำและตรวจสอบความถูกต้องของข้อมูล (Strict Basin & DTO Validation)**:
   - ควบคุมความถูกต้องของข้อมูลด้วย **Zod Schema DTOs** ทั้งชุดข้อมูลสถานีและลุ่มน้ำ
   - จัดการลุ่มน้ำอย่างเป็นระบบผ่าน API (`POST /api/admin/basins`)
   - ป้องกันข้อมูลผิดพลาดด้วยการบังคับตรวจสอบ Basin ในฐานข้อมูลล่วงหน้า (`?basin=...`) หากไม่มีจะปฏิเสธการอัปโหลดทันที (Strict Basin Check)
5. **Automated Telemetry Ingestion & Rotation**:
   - ซิงค์ข้อมูลระดับน้ำและฝนจาก ThaiWater API ทุก 15 นาที
   - หมุนเวียนข้อมูลสถานการณ์ล่าสุดเข้าตาราง `telemetry_latest` และเก็บประวัติใน `telemetry_history`
   - Auto-publish ข้อมูล `current.json`, `overview.json`, และ `feed.json` ไปยัง R2 แบบอัตโนมัติ

---

## 📁 โครงสร้างชุดข้อมูลบน Cloudflare R2 (R2 Storage Hierarchy)

Frontend สามารถดึงข้อมูลผ่าน CDN URL หรือ Local Mock (`/r2-static/...`) ได้ตามโครงสร้าง:

| Path บน R2 | ประเภท | คำอธิบาย |
| :--- | :--- | :--- |
| `basins.json` | JSON | รายชื่อลุ่มน้ำทั้งหมดที่เปิดใช้งาน (`is_active = true`) |
| `waterlevel_station/{basin}/stations.json` | JSON | สรุปรายการสถานีวัดระดับน้ำทั้งหมดในลุ่มน้ำ |
| `waterlevel_station/{basin}/{id}/detail.json` | JSON | ข้อมูลรายละเอียดสถานี, พิกัด, ตลิ่ง, เกณฑ์เตือนภัย และ `relationsSummary` |
| `waterlevel_station/{basin}/{id}/current.json` | JSON | ข้อมูลโทรมาตรระดับน้ำปัจจุบัน, แนวโน้ม, สถานะความสดใหม่ |
| `waterlevel_station/{basin}/{id}/relations.json` | JSON | สถานีฝนที่ส่งน้ำมา (`influencingRainfallStations`) และสถานีรับน้ำถัดไป (`streamFall`) |
| `rainfall_station/{basin}/stations.json` | JSON | สรุปรายการสถานีวัดน้ำฝนทั้งหมดในลุ่มน้ำ |
| `rainfall_station/{basin}/{id}/detail.json` | JSON | ข้อมูลรายละเอียดสถานีฝน, พิกัด, เกณฑ์ฝนตกหนัก และ `relationsSummary` |
| `rainfall_station/{basin}/{id}/current.json` | JSON | ข้อมูลปริมาณฝน 1h, 3h, 24h, วันนี้ และสถานะปัจจุบัน |
| `rainfall_station/{basin}/{id}/relations.json` | JSON | สถานีวัดน้ำที่รับน้ำจากสถานีฝนนี้ (`receivingWaterlevelStations`) |
| `basin/{basin}/overview.json` | JSON | สรุปภาพรวมสถานการณ์น้ำทั้งลุ่มน้ำ, จำนวนสถานีวิกฤต/เตือนภัย |
| `basin/{basin}/events/feed.json` | JSON | ฟีดแจ้งเตือนเหตุการณ์น้ำหลาก / เตือนภัยระดับลุ่มน้ำ |
| `basin/{basin}/report/bulletin-latest.json` | JSON | รายงานสรุปสถานการณ์น้ำรายวัน (AI Bulletin) |
| `basin/{basin}/spatial/boundary.geojson` | GeoJSON | ขอบเขตลุ่มน้ำจริง (Official Basin Boundary Polygon) |
| `basin/{basin}/spatial/rivers.geojson` | GeoJSON | โครงข่ายลำน้ำ (River Network / Waterways) |

---

## 🗄️ โครงสร้างฐานข้อมูล (Database Schema)

ระบบขับเคลื่อนด้วย **PostgreSQL** และจัดการผ่าน **Drizzle ORM**:

* **`basins`**: ตารางลุ่มน้ำ
  * `id`, `slug`, `code`, `name_th`, `name_en`
  * `is_active` (boolean - ใช้เปิด/ปิดการแสดงผลลุ่มน้ำ)
  * `boundary_geojson_path` (text - เก็บ path ของไฟล์ GeoJSON บน R2, `null` = ยังไม่ได้อัปโหลด)
  * `area_km2`, `status`
* **`waterlevel_stations`**: ตารางสถานีวัดระดับน้ำ
  * `id`, `basin_id`, `name_th`, `name_en`, `lat`, `lon`
  * `ground_level`, `min_bank`, `qmax`, `river_name`, `agency_*`, `province_*`
  * `raw_metadata`: จัดเก็บ `influencingRainfallStations` และ `streamFall`
* **`rainfall_stations`**: ตารางสถานีวัดปริมาณน้ำฝน
  * `id`, `basin_id`, `name_th`, `name_en`, `lat`, `lon`
  * `warning_rain_24h`, `critical_rain_24h`, `agency_*`, `province_*`
  * `raw_metadata`: จัดเก็บ `receivingWaterlevelStations`
* **`station_relations`**: ตารางความสัมพันธ์ทางอุทกวิทยา (Normalized Graph)
  * `station_id`, `target_station_id`, `relation_type` (`downstream` หรือ `influencing`)
  * `distance_km`, `travel_time_hours`, `travel_time_minutes`, `confidence`, `response_type`
* **`telemetry_latest`**: ข้อมูลโทรมาตรล่าสุดของแต่ละสถานี
* **`telemetry_history`**: ข้อมูลโทรมาตรย้อนหลังสำหรับทำกราฟ Time-series
* **`dataset_registry`**: ตรวจสอบประวัติและ ETag ของไฟล์บน Cloudflare R2
* **`ingestion_jobs`**: ประวัติและสถานะการทำงานของ Cron Ingestion

---

## 🔌 รายการ API Endpoints (API Reference)

### 1. ระบบผู้ดูแลและอัปโหลดข้อมูล (Admin APIs)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `POST` | `/api/admin/basins` | สร้างข้อมูลลุ่มน้ำใหม่ในระบบ (บันทึกลง DB พร้อมอัปเดต `basins.json` บน R2 ทันที) |
| `POST` | `/api/admin/stations/upload/waterlevel?basin=xxx` | อัปโหลดสถานีวัดระดับน้ำแบบระบุลุ่มน้ำ (DTO Validated, ตรวจสอบ Basin ใน DB, บันทึก DB + Auto Publish R2) |
| `POST` | `/api/admin/stations/upload/rainfall?basin=xxx` | อัปโหลดสถานีวัดน้ำฝนแบบระบุลุ่มน้ำ (DTO Validated, ตรวจสอบ Basin ใน DB, บันทึก DB + Auto Publish R2) |
| `POST` | `/api/admin/stations/upload` | อัปโหลดไฟล์สถานีแบบทั่วไป (Auto-detect ระดับน้ำ/น้ำฝน พร้อม DTO validation) |
| `POST` | `/api/admin/relations/upload` | อัปโหลดไฟล์ `relations_frontend.json` (บันทึก metadata 2 ทิศทาง + Auto Publish R2) |
| `POST` | `/api/admin/basins/:slug/boundary` | อัปโหลดไฟล์ GeoJSON ขอบเขตลุ่มน้ำขึ้น R2 และบันทึก path ลงในตาราง `basins` |
| `POST` | `/api/admin/import-all-datasets` | สั่งนำเข้าชุดข้อมูลสถานีและความสัมพันธ์ทุกกลุ่มน้ำจากโฟลเดอร์โมเดลอัตโนมัติ |
| `POST` | `/api/admin/rebuild-r2` | สั่ง Rebuild และสร้างไฟล์ R2 Datasets ทั้งหมดใหม่จาก Database |
| `GET` | `/api/admin/data-quality` | ตรวจสอบ Data Quality (ความสดใหม่, ข้อมูลขาดหาย, สถานีวิกฤต) |

#### ตัวอย่างการเรียกใช้งาน Admin APIs (cURL Examples)

**1. สร้างลุ่มน้ำใหม่ (Create Basin):**
```bash
curl -X POST http://localhost:3001/api/admin/basins \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "sakae-krang",
    "nameTh": "ลุ่มน้ำสะแกกรัง",
    "nameEn": "Sakae Krang Basin",
    "code": "13",
    "isActive": true
  }'
```

**2. อัปโหลดสถานีวัดระดับน้ำ (Upload Waterlevel Stations):**
```bash
# อัปโหลดผ่านไฟล์ multipart/form-data
curl -X POST "http://localhost:3001/api/admin/stations/upload/waterlevel?basin=yom" \
  -F "file=@yom_waterlevel_stations.json"

# หรือส่งผ่าน Raw JSON Array โดยตรง
curl -X POST "http://localhost:3001/api/admin/stations/upload/waterlevel?basin=yom" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 1001,
      "station": {
        "tele_station_name": { "th": "สถานีบ้านหาดใหญ่", "en": "Ban Hat Yai" },
        "lat": 17.5123,
        "long": 99.8123
      }
    }
  ]'
```

**3. อัปโหลดสถานีวัดน้ำฝน (Upload Rainfall Stations):**
```bash
curl -X POST "http://localhost:3001/api/admin/stations/upload/rainfall?basin=yom" \
  -F "file=@yom_rain_stations.json"
```

**4. อัปโหลดความสัมพันธ์ทางอุทกวิทยา (Upload Relations):**
```bash
curl -X POST http://localhost:3001/api/admin/relations/upload \
  -F "file=@relations_frontend.json"
```

**5. อัปโหลดขอบเขตลุ่มน้ำ GeoJSON (Upload Basin Boundary):**
```bash
curl -X POST http://localhost:3001/api/admin/basins/yom/boundary \
  -F "file=@yom_boundary.geojson"
```

### 2. ข้อมูลลุ่มน้ำ (Basin APIs)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/basins` | รายชื่อลุ่มน้ำทั้งหมดพร้อมสถิติ (รองรับ `?active=true`) |
| `GET` | `/api/basins/:slug` | ข้อมูลรายละเอียดและเมตริกสถานการณ์น้ำของลุ่มน้ำ |
| `GET` | `/api/basins/:slug/report` | ดึงรายงานสรุปสถานการณ์น้ำล่าสุด (AI Bulletin) |

### 3. ข้อมูลสถานีโทรมาตร (Station APIs)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/stations` | ค้นหาและกรองสถานี (`?basin=yom&type=water_level`) |
| `GET` | `/api/stations/:id` | ข้อมูลรายละเอียดและโทรมาตรปัจจุบันของสถานี |
| `GET` | `/api/stations/:id/history` | ข้อมูลโทรมาตรย้อนหลัง (`?days=7`) |
| `GET` | `/api/stations/:id/relations` | ข้อมูลความสัมพันธ์ต้นน้ำ-ท้ายน้ำ |

### 4. ระบบอัตโนมัติ (Cron APIs - รองรับ Bearer `<CRON_SECRET>`)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `POST` | `/api/cron/sync-all` | ซิงค์ข้อมูล ThaiWater API, อัปเดต DB และ Publish ไฟล์ R2 ทันที |
| `POST` | `/api/cron/sync-telemetry` | ดึงและบันทึกโทรมาตรเข้า DB อย่างเดียว |
| `POST` | `/api/cron/publish-r2` | สร้างและส่งออก R2 Datasets จากฐานข้อมูล |
| `GET` | `/api/cron/status` | ตรวจสอบสถานะการทำงานของ Cron Sync ย้อนหลัง |

### 5. Local R2 Static File Mirror (สำหรับทดสอบในเครื่อง)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/r2-static/*` | จำลองการอ่านไฟล์จาก Cloudflare R2 จากโฟลเดอร์ `.r2-local/` |

---

## 🚀 การติดตั้งและเริ่มต้นใช้งาน (Getting Started)

### ข้อกำหนดเบื้องต้น (Prerequisites)
* [Bun Runtime](https://bun.sh/) (แนะนำเวอร์ชัน 1.4 ขึ้นไป)
* [PostgreSQL](https://www.postgresql.org/) (เวอร์ชัน 14 ขึ้นไป)

### 1. ติดตั้ง Dependencies
```bash
git clone https://github.com/korarit/flood-analysis-backend.git
cd flood-analysis-backend
bun install
```

### 2. ตั้งค่าสภาพแวดล้อม (.env)
คัดลอกไฟล์ตัวอย่าง `.env.example` เป็น `.env`:
```bash
cp .env.example .env
```
กำหนดค่าที่จำเป็น:
```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgres://postgres:password@localhost:5432/water_analysis

CRON_SECRET=your_secure_cron_secret_key

# ThaiWater API (ถ้าต้องการดึงข้อมูลสด)
THAIWATER_API_BASE_URL=https://twa-api-public.thaiwater.net
THAIWATER_API_KEY=your_api_key

# Cloudflare R2 (เปิด R2_LOCAL_FALLBACK=true สำหรับรันในเครื่อง)
R2_LOCAL_FALLBACK=true
R2_BUCKET_NAME=water-analysis-public
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key

# AI Bulletin
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=your_model
```

### 3. เตรียมฐานข้อมูล
```bash
# Push Schema ไปยัง PostgreSQL
bun run db:push

# ใส่ข้อมูลเริ่มต้นและนำเข้าข้อมูลสถานี/ความสัมพันธ์อัตโนมัติ
bun run db:seed
```

### 4. รันเซิร์ฟเวอร์
```bash
bun run dev
```
เข้าใช้งาน API ได้ที่ [http://localhost:3001](http://localhost:3001)

---

## 🛠️ คำสั่งสคริปต์ (Available Scripts)

| คำสั่ง | คำอธิบาย |
| :--- | :--- |
| `bun run dev` | รันเซิร์ฟเวอร์โหมด Development พร้อม Hot Reload (`--watch`) |
| `bun run start` | รันเซิร์ฟเวอร์โหมด Production |
| `bun run build` | คอมไพล์โปรเจกต์ด้วย Bun Bundler ไปยัง `dist/` |
| `bun run typecheck` | ตรวจสอบ TypeScript Types (`tsc --noEmit`) |
| `bun run sync` | รัน Scraper ดึงข้อมูลโทรมาตรจาก ThaiWater, อัปเดต DB และ Sync R2 (รองรับ `all` ทุกลุ่มน้ำ หรือระบุลุ่มน้ำ เช่น `bun run sync all`, `bun run sync yom`) |
| `bun run sync:all` | รัน Scraper โทรมาตรทุกลุ่มน้ำ พร้อม Rebuild R2 Datasets ทั้งหมดใหม่ |
| `bun run scraper` | คำสั่งทางเลือกสำหรับรัน Scraper ดึงข้อมูลโทรมาตร (รองรับ `bun run scraper all`) |
| `bun run db:push` | ซิงค์ Drizzle Schema ไปยัง PostgreSQL โดยตรง |
| `bun run db:migrate` | รันไฟล์ SQL Migrations |
| `bun run db:studio` | เปิด [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) Web UI จัดการฐานข้อมูล |
| `bun run db:seed` | รัน Seeding นำเข้าข้อมูลลุ่มน้ำ สถานี และความสัมพันธ์ |

---

## 📄 ใบอนุญาต (License)

โปรเจกต์นี้เผยแพร่ภายใต้ [MIT License](LICENSE)
