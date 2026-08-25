# 🌊 Flood Analysis Backend (Water Situation Platform)

[![Bun](https://img.shields.io/badge/Bun-1.4+-fbf0df?style=flat&logo=bun&logoColor=black)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4.13-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare_R2-S3_Compatible-F38020?style=flat&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/products/r2/)
[![AI Powered](https://img.shields.io/badge/AI-LLM_Bulletin-412991?style=flat)](https://github.com/korarit/flood-analysis-backend)

**Flood Analysis Backend** คือระบบหลังบ้านประสิทธิภาพสูงสำหรับรวบรวมข้อมูลโทรมาตรน้ำ (Telemetry Ingestion), ประมวลผลและวิเคราะห์ข้อมูลสถานการณ์น้ำท่วมและน้ำหลากแบบหลายลุ่มน้ำ (Multi-Basin) พร้อมระบบเผยแพร่ข้อมูลแบบ Static JSON / GeoJSON Datasets ไปยัง Cloudflare R2 เพื่อให้ Frontend ดึงข้อมูลผ่าน CDN ได้อย่างรวดเร็วและรองรับผู้ใช้งานจำนวนมหาศาลโดยไม่กระทบฐานข้อมูลหลัก

---

## 🏛️ สถาปัตยกรรมระบบ (System Architecture)

ระบบออกแบบตามแนวคิด **One Platform + One Backend + Multiple Basins + Public R2 Datasets + REST API**:

```text
┌─────────────────────────────────┐
│     ThaiWater Public APIs       │ (กรมทรัพยากรน้ำ / สสน.)
└────────────────┬────────────────┘
                 │ Cron Ingestion (Periodic Sync)
                 ▼
┌────────────────────────────────────────────────────────┐
│              Flood Analysis Backend (Bun + Hono)       │
│                                                        │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │   Drizzle ORM + PG   │    │  R2 Publisher Engine │  │
│  │  (Normalized Store)  │───▶│ (JSON & GeoJSON Gen) │  │
│  └──────────────────────┘    └──────────┬───────────┘  │
│                                         │              │
│  ┌──────────────────────┐               │              │
│  │ LLM Bulletin Service │               │              │
│  │ (AI Situation Report)│               │              │
│  └──────────────────────┘               │              │
└─────────────────────────────────────────┼──────────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
          ┌───────────────────────────┐       ┌───────────────────────────┐
          │    Cloudflare R2 Bucket   │       │   Backend REST APIs       │
          │   (Public Static CDN)     │       │   (Real-time Query)       │
          │   - /basin/{id}/overview  │       │   - /api/basins           │
          │   - /basin/{id}/stations  │       │   - /api/stations         │
          │   - /basin/{id}/spatial   │       │   - /api/cron/*           │
          └─────────────┬─────────────┘       └─────────────┬─────────────┘
                        │                                   │
                        └─────────────────┬─────────────────┘
                                          ▼
                         ┌─────────────────────────────────┐
                         │     Flood Analysis Frontend     │
                         │      (React + TanStack Router)  │
                         └─────────────────────────────────┘
```

---

## ✨ คุณสมบัติเด่น (Key Features)

- ⚡ **High-Performance Runtime**: ขับเคลื่อนด้วย **Bun** และ **Hono Framework** ทำงานได้รวดเร็ว ใช้หน่วยความจำต่ำ
- 🔄 **Automated Telemetry Ingestion**: เชื่อมต่อดึงข้อมูลตรวจวัดระดับน้ำและปริมาณน้ำฝนจาก ThaiWater Platform อัตโนมัติ
- ☁️ **Cloudflare R2 Dataset Publishing**: สร้างและอัปโหลดไฟล์สรุปสถานการณ์ (JSON) และข้อมูลเชิงพื้นที่ (GeoJSON) ไปยัง Cloudflare R2 ทำให้ฝั่งผู้ใช้งานเปิดดูข้อมูลได้ทันทีแบบ Zero DB Query Latency
- 🤖 **AI Hydrological Bulletin Generator**: สรุปสถานการณ์น้ำรายวันและประเมินความเสี่ยงลุ่มน้ำอัตโนมัติด้วย AI / LLM
- 📊 **Data Freshness & Health Monitoring**: ตรวจสอบความสดใหม่ของข้อมูลสถานี (Fresh / Delayed / Missing) พร้อมระบบตรวจสอบ Data Quality
- 🛡️ **Secure Cron & Admin Triggers**: มีระบบรักษาความปลอดภัย Cronjob ด้วย Bearer Token (`CRON_SECRET`)
- 💾 **Offline Local Storage Fallback**: รองรับโหมดจำลอง R2 (`.r2-local/`) สำหรับการพัฒนาในเครื่องโดยไม่ต้องต่อ Cloudflare R2 จริง

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

| หมวดหมู่ | เทคโนโลยี |
| :--- | :--- |
| **Runtime Environment** | [Bun](https://bun.sh/) (v1.4+) |
| **Web Framework** | [Hono](https://hono.dev/) (v4.13) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) (Strict Mode) |
| **Database & ORM** | [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) + [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) |
| **Object Storage** | [Cloudflare R2](https://www.cloudflare.com/products/r2/) via `@aws-sdk/client-s3` |
| **AI / LLM** | LLM API Integration (Structured Output & Bulletin Generation) |
| **Validation** | [Zod](https://zod.dev/) + `@hono/zod-validator` |

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
flood-analysis-backend/
├── drizzle/                    # SQL Migration files
├── src/
│   ├── config/                 # Environment & Service configurations
│   │   ├── env.ts              # Zod environment variable validator
│   │   └── r2.ts               # S3/R2 client instance
│   ├── db/                     # Database setup and Schema definitions
│   │   ├── schema/             # Drizzle table schemas
│   │   │   ├── basins.ts           # ลุ่มน้ำและขอบเขตพิกัด
│   │   │   ├── stations.ts         # ข้อมูลสถานีโทรมาตร
│   │   │   ├── telemetry.ts        # ข้อมูลระดับน้ำ/น้ำฝน ปัจจุบันและย้อนหลัง
│   │   │   ├── stationRelations.ts # ลำดับต้นน้ำ-ท้ายน้ำ (River Chain)
│   │   │   ├── datasetRegistry.ts  # บันทึกสถานะ R2 Datasets
│   │   │   └── ingestionJobs.ts    # ประวัติการรัน Cron Sync
│   │   ├── index.ts            # Postgres Connection instance
│   │   └── seed.ts             # Initial Master Data seeder
│   ├── middleware/             # Request Middlewares
│   │   ├── cors.ts             # CORS Configuration
│   │   ├── cronAuth.ts         # Bearer Secret authentication
│   │   └── errorHandler.ts     # Global JSON error handler
│   ├── routes/                 # API Route Handlers
│   │   ├── admin.ts            # Data quality, manual triggers & status
│   │   ├── basins.ts           # Basin list & detailed metrics
│   │   ├── cron.ts             # Ingestion & R2 publishing cron triggers
│   │   ├── health.ts           # Service & DB health check
│   │   └── stations.ts         # Station listing & history queries
│   ├── services/               # Core Business Logic
│   │   ├── llmBulletinService.ts   # AI Hydrological Bulletin generator
│   │   ├── r2PublisherService.ts   # R2 JSON/GeoJSON static dataset generator
│   │   ├── r2StorageService.ts     # S3/R2 Put/Get/Mirror adapter
│   │   └── thaiWaterIngestion.ts   # ThaiWater API fetcher & normalizer
│   ├── types/                  # TypeScript Type definitions
│   └── index.ts                # Application Entry Point
├── .env.example                # Example environment variables
├── drizzle.config.ts           # Drizzle Kit migration configuration
├── package.json                # Dependencies & scripts
└── tsconfig.json               # TypeScript configuration
```

---

## 🔌 รายการ API Endpoints (API Reference)

### 1. Health & Welcome
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/` | ข้อมูลเวอร์ชันและรายการ Route ทั้งหมด |
| `GET` | `/health` หรือ `/api/health` | Health Check (ตรวจสอบสถานะ Backend, DB, R2) |

### 2. ข้อมูลลุ่มน้ำ (Basin APIs)
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/basins` | รายชื่อลุ่มน้ำทั้งหมดพร้อมสถิติสถานการณ์น้ำ |
| `GET` | `/api/basins/:slug` | ข้อมูลภาพรวมเชิงลึกของลุ่มน้ำ (เช่น `/api/basins/yom`) |
| `GET` | `/api/basins/:slug/report` | ดึงรายงานสรุปสถานการณ์น้ำล่าสุด (Bulletin) |

### 3. ข้อมูลสถานีโทรมาตร (Station APIs)
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/stations` | ค้นหาและกรองรายการสถานี (`?basin=yom&type=water_level`) |
| `GET` | `/api/stations/:id` | ข้อมูลรายละเอียดและโทรมาตรปัจจุบันของสถานี |
| `GET` | `/api/stations/:id/history` | ข้อมูลโทรมาตรย้อนหลังสูงสุด 7 วัน (`?days=7`) |
| `GET` | `/api/stations/:id/relations` | ความสัมพันธ์สถานีต้นน้ำ-ท้ายน้ำ |

### 4. ระบบอัตโนมัติ (Cron APIs - ต้องระบุ `Authorization: Bearer <CRON_SECRET>`)
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `POST` | `/api/cron/sync-all` | ทำการดึงข้อมูลจาก ThaiWater, อัปเดต DB และสร้าง R2 Datasets ทันที |
| `POST` | `/api/cron/sync-telemetry` | ดึงและบันทึกข้อมูลโทรมาตรเข้า PostgreSQL อย่างเดียว |
| `POST` | `/api/cron/publish-r2` | สั่งสร้างและอัปโหลด R2 Datasets ใหม่จาก DB |
| `GET` | `/api/cron/status` | ดูประวัติและสถานะการทำงานของ Cron Sync ย้อนหลัง |

### 5. ระบบผู้ดูแลและจัดการข้อมูล (Admin APIs)
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/admin/data-quality` | รายงานคุณภาพข้อมูล (ความสดใหม่, ข้อมูลขาดหาย, สถานีวิกฤต) |
| `GET` | `/api/admin/jobs` | รายการ Job การประมวลผลย้อนหลัง |
| `GET` | `/api/admin/datasets` | รายการสถานะ Datasets ที่ถูกบันทึกบน R2 |
| `POST` | `/api/admin/bulletin/generate` | สั่ง AI สร้างรายงานสรุปสถานการณ์น้ำใหม่ทันที |

### 6. Local R2 Static File Mirror (โหมดทดสอบในเครื่อง)
| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/r2-static/*` | เสิร์ฟไฟล์ JSON/GeoJSON ที่ถูกจำลองไว้ในโฟลเดอร์ `.r2-local/` |

---

## 🚀 การติดตั้งและเริ่มต้นใช้งาน (Getting Started)

### ข้อกำหนดเบื้องต้น (Prerequisites)
1. ติดตั้ง [Bun Runtime](https://bun.sh/) (แนะนำเวอร์ชัน 1.4 ขึ้นไป)
2. ติดตั้ง [PostgreSQL](https://www.postgresql.org/) (เวอร์ชัน 14 ขึ้นไป)

### 1. โคลน Repository และติดตั้ง Dependencies

```bash
git clone https://github.com/korarit/flood-analysis-backend.git
cd flood-analysis-backend

# ติดตั้งแพ็กเกจด้วย Bun
bun install
```

### 2. ตั้งค่าไฟล์สภาพแวดล้อม (.env)

คัดลอกไฟล์ตัวอย่าง `.env.example` ไปเป็น `.env`:

```bash
cp .env.example .env
```

แก้ไขค่าใน `.env` ให้ตรงกับระบบของคุณ:
```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgres://postgres:password@localhost:5432/water_analysis

CRON_SECRET=your_secure_cron_secret_key_2026

# ThaiWater Public API Credentials
THAIWATER_API_BASE_URL=https://twa-api-public.thaiwater.net
THAIWATER_API_KEY=your_thaiwater_api_key

# Cloudflare R2 Credentials (หากยังไม่มี ให้เปิด R2_LOCAL_FALLBACK=true)
R2_LOCAL_FALLBACK=true
R2_BUCKET_NAME=water-analysis-public
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key

# AI / LLM Configuration สำหรับสร้างรายงานสรุปสถานการณ์น้ำ
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=your_preferred_model
```

### 3. เตรียมฐานข้อมูล (Database Migration & Seeding)

```bash
# Push Schema ไปยัง PostgreSQL
bun run db:push

# ใส่ข้อมูลเริ่มต้นของลุ่มน้ำและสถานี (Master Seed Data)
bun run db:seed
```

### 4. รันเซิร์ฟเวอร์ใน Development Mode

```bash
bun run dev
```

เซิร์ฟเวอร์จะเริ่มทำงานที่ [http://localhost:3001](http://localhost:3001)

---

## 🛠️ คำสั่ง Script ทั้งหมด (Available Scripts)

| คำสั่ง | คำอธิบาย |
| :--- | :--- |
| `bun run dev` | รันเซิร์ฟเวอร์ใน Development Mode พร้อม Hot Reload (`--watch`) |
| `bun run start` | รันเซิร์ฟเวอร์ใน Production Mode |
| `bun run build` | คอมไพล์โปรเจกต์ด้วย Bun Bundler ไปยังโฟลเดอร์ `dist/` |
| `bun run typecheck` | ตรวจสอบความถูกต้องของ TypeScript Types (`tsc --noEmit`) |
| `bun run db:push` | ซิงค์ Drizzle Schema ไปยัง PostgreSQL โดยตรง |
| `bun run db:migrate` | รันไฟล์ SQL Migration ที่อยู่ในโฟลเดอร์ `drizzle/` |
| `bun run db:studio` | เปิด [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) Web UI สำหรับจัดการฐานข้อมูล |
| `bun run db:seed` | นำเข้าข้อมูลเริ่มต้นของลุ่มน้ำและสถานี |

---

## 📄 ใบอนุญาต (License)

โปรเจกต์นี้เผยแพร่ภายใต้ [MIT License](LICENSE)
