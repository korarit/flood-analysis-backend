import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { basins, waterlevelStations } from "../db/schema";
import { getModelDatasetDir } from "./paths";

export interface MasterBasinConfig {
  id: string;
  slug: string;
  code: string;
  nameTh: string;
  nameEn: string;
  descriptionTh: string;
  descriptionEn: string;
  areaKm2: number;
  bgGradient: string;
  accentColor: string;
  center: [number, number];
  zoom: number;
  mainRivers: Array<{ th: string; en: string }>;
  thaiWaterName: string;
  isActive: boolean;
  status: "active" | "inactive";
}

export const MASTER_BASINS: MasterBasinConfig[] = [
  {
    id: "yom",
    slug: "yom",
    code: "08",
    nameTh: "ลุ่มน้ำยม",
    nameEn: "Yom River Basin",
    descriptionTh: "ลุ่มน้ำยมครอบคลุมพื้นที่จังหวัดพะเยา แพร่ สุโขทัย พิษณุโลก และพิจิตร",
    descriptionEn: "The Yom River Basin covers Phayao, Phrae, Sukhothai, Phitsanulok, and Phichit provinces.",
    areaKm2: 23616,
    bgGradient: "from-teal-950 via-slate-900 to-cyan-950",
    accentColor: "#06B6D4",
    center: [17.5, 100.0],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำยม", en: "Yom River" },
      { th: "ลำน้ำควร", en: "Khuan River" },
      { th: "แม่น้ำงาว", en: "Ngao River" },
      { th: "คลองหกบาท", en: "Khlong Hok Bat" },
    ],
    thaiWaterName: "ยม",
    isActive: true,
    status: "active",
  },
  {
    id: "ping",
    slug: "ping",
    code: "06",
    nameTh: "ลุ่มน้ำปิง",
    nameEn: "Ping River Basin",
    descriptionTh: "ลุ่มน้ำปิงครอบคลุมพื้นที่จังหวัดเชียงใหม่ ลำพูน ตาก และกำแพงเพชร",
    descriptionEn: "The Ping River Basin covers Chiang Mai, Lamphun, Tak, and Kamphaeng Phet provinces.",
    areaKm2: 33898,
    bgGradient: "from-sky-950 via-slate-900 to-blue-950",
    accentColor: "#0EA5E9",
    center: [18.5, 99.0],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำปิง", en: "Ping River" },
      { th: "แม่น้ำกวง", en: "Kuang River" },
      { th: "แม่น้ำแจ่ม", en: "Chaem River" },
      { th: "แม่น้ำงัด", en: "Ngat River" },
    ],
    thaiWaterName: "ปิง",
    isActive: true,
    status: "active",
  },
  {
    id: "wang",
    slug: "wang",
    code: "07",
    nameTh: "ลุ่มน้ำวัง",
    nameEn: "Wang River Basin",
    descriptionTh: "ลุ่มน้ำวังครอบคลุมพื้นที่จังหวัดลำปางและตาก",
    descriptionEn: "The Wang River Basin covers Lampang and Tak provinces.",
    areaKm2: 10792,
    bgGradient: "from-emerald-950 via-slate-900 to-slate-950",
    accentColor: "#10B981",
    center: [17.8, 99.2],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำวัง", en: "Wang River" },
      { th: "แม่น้ำตุ๋ย", en: "Tui River" },
      { th: "แม่น้ำจาง", en: "Chang River" },
      { th: "แม่น้ำสอย", en: "Soi River" },
    ],
    thaiWaterName: "วัง",
    isActive: true,
    status: "active",
  },
  {
    id: "nan",
    slug: "nan",
    code: "09",
    nameTh: "ลุ่มน้ำน่าน",
    nameEn: "Nan River Basin",
    descriptionTh: "ลุ่มน้ำน่านครอบคลุมพื้นที่จังหวัดน่าน อุตรดิตถ์ พิษณุโลก และพิจิตร",
    descriptionEn: "The Nan River Basin covers Nan, Uttaradit, Phitsanulok, and Phichit provinces.",
    areaKm2: 34330,
    bgGradient: "from-blue-950 via-slate-900 to-indigo-950",
    accentColor: "#3B82F6",
    center: [18.2, 100.8],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำน่าน", en: "Nan River" },
      { th: "แม่น้ำว้า", en: "Wa River" },
      { th: "แม่น้ำปาด", en: "Pat River" },
      { th: "แม่น้ำแควน้อย", en: "Khwae Noi River" },
    ],
    thaiWaterName: "น่าน",
    isActive: true,
    status: "active",
  },
  {
    id: "chi",
    slug: "chi",
    code: "04",
    nameTh: "ลุ่มน้ำชี",
    nameEn: "Chi River Basin",
    descriptionTh: "ลุ่มน้ำชีครอบคลุมพื้นที่ภาคตะวันออกเฉียงเหนือตอนกลาง",
    descriptionEn: "The Chi River Basin covers central northeastern Thailand.",
    areaKm2: 49477,
    bgGradient: "from-violet-950 via-slate-900 to-slate-950",
    accentColor: "#8B5CF6",
    center: [16.0, 102.8],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำชี", en: "Chi River" },
      { th: "ลำน้ำพอง", en: "Lam Nam Phong" },
      { th: "ลำปาว", en: "Lam Pao" },
      { th: "ลำน้ำเชิญ", en: "Lam Nam Choen" },
    ],
    thaiWaterName: "ชี",
    isActive: true,
    status: "active",
  },
  {
    id: "mun",
    slug: "mun",
    code: "03",
    nameTh: "ลุ่มน้ำมูล",
    nameEn: "Mun River Basin",
    descriptionTh: "ลุ่มน้ำมูลครอบคลุมพื้นที่ภาคตะวันออกเฉียงเหนือตอนล่าง",
    descriptionEn: "The Mun River Basin covers lower northeastern Thailand.",
    areaKm2: 70966,
    bgGradient: "from-amber-950 via-slate-900 to-slate-950",
    accentColor: "#F59E0B",
    center: [15.2, 103.5],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำมูล", en: "Mun River" },
      { th: "ลำตะคอง", en: "Lam Takhong" },
      { th: "ลำพระเพลิง", en: "Lam Phra Phloeng" },
      { th: "ลำเซบาย", en: "Lam Se Bai" },
      { th: "ลำโดมใหญ่", en: "Lam Dom Yai" },
    ],
    thaiWaterName: "มูล",
    isActive: true,
    status: "active",
  },
  {
    id: "khong-north",
    slug: "khong-north",
    code: "02",
    nameTh: "ลุ่มน้ำโขงเหนือ",
    nameEn: "North Khong River Basin",
    descriptionTh: "ลุ่มน้ำโขงเหนือครอบคลุมพื้นที่จังหวัดเชียงรายและพะเยา",
    descriptionEn: "The North Khong River Basin covers Chiang Rai and Phayao provinces.",
    areaKm2: 17400,
    bgGradient: "from-cyan-950 via-slate-900 to-teal-950",
    accentColor: "#14B8A6",
    center: [19.8, 100.0],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำโขง", en: "Mekong River" },
      { th: "แม่น้ำกก", en: "Kok River" },
      { th: "แม่น้ำสาย", en: "Sai River" },
      { th: "แม่น้ำอิง", en: "Ing River" },
    ],
    thaiWaterName: "โขงเหนือ",
    isActive: true,
    status: "active",
  },
  {
    id: "pa-sak",
    slug: "pa-sak",
    code: "05",
    nameTh: "ลุ่มน้ำป่าสัก",
    nameEn: "Pasak River Basin",
    descriptionTh: "ลุ่มน้ำป่าสักครอบคลุมพื้นที่จังหวัดเลย เพชรบูรณ์ ลพบุรี สระบุรี และพระนครศรีอยุธยา",
    descriptionEn: "The Pasak River Basin covers Loei, Phetchabun, Lopburi, Saraburi, and Phra Nakhon Si Ayutthaya provinces.",
    areaKm2: 15887,
    bgGradient: "from-emerald-950 via-slate-900 to-teal-950",
    accentColor: "#10B981",
    center: [15.8, 101.1],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำป่าสัก", en: "Pa Sak River" },
      { th: "ลำสนธิ", en: "Lam Sonthi" },
      { th: "ห้วยป่าแดง", en: "Huai Pa Daeng" },
      { th: "ลำพญากลาง", en: "Lam Phraya Klang" },
      { th: "แม่น้ำลพบุรี", en: "Lopburi River" },
    ],
    thaiWaterName: "ป่าสัก",
    isActive: true,
    status: "active",
  },
  {
    id: "sakaekrang",
    slug: "sakaekrang",
    code: "11",
    nameTh: "ลุ่มน้ำสะแกกรัง",
    nameEn: "Sakae Krang River Basin",
    descriptionTh: "ลุ่มน้ำสะแกกรังครอบคลุมพื้นที่จังหวัดอุทัยธานี นครสวรรค์ และกำแพงเพชร",
    descriptionEn: "The Sakae Krang River Basin covers Uthai Thani, Nakhon Sawan, and Kamphaeng Phet provinces.",
    areaKm2: 5020,
    bgGradient: "from-lime-950 via-slate-900 to-emerald-950",
    accentColor: "#84CC16",
    center: [15.5, 99.7],
    zoom: 9,
    mainRivers: [
      { th: "แม่น้ำสะแกกรัง", en: "Sakae Krang River" },
      { th: "คลองโพธิ์", en: "Khlong Pho" },
      { th: "ห้วยทับเสลา", en: "Huai Thap Salao" },
      { th: "ห้วยขาแข้ง", en: "Huai Kha Khaeng" },
    ],
    thaiWaterName: "สะแกกรัง",
    isActive: true,
    status: "active",
  },
  {
    id: "tha-chin",
    slug: "tha-chin",
    code: "13",
    nameTh: "ลุ่มน้ำท่าจีน",
    nameEn: "Tha Chin River Basin",
    descriptionTh: "ลุ่มน้ำท่าจีนครอบคลุมพื้นที่จังหวัดชัยนาท สุพรรณบุรี นครปฐม และสมุทรสาคร",
    descriptionEn: "The Tha Chin River Basin covers Chai Nat, Suphan Buri, Nakhon Pathom, and Samut Sakhon provinces.",
    areaKm2: 13681,
    bgGradient: "from-blue-950 via-slate-900 to-teal-950",
    accentColor: "#0284C7",
    center: [14.4, 100.0],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำท่าจีน", en: "Tha Chin River" },
      { th: "แม่น้ำสุพรรณบุรี", en: "Suphan Buri River" },
      { th: "คลองมะขามเฒ่า", en: "Khlong Makham Thao" },
      { th: "ห้วยกระเสียว", en: "Huai Krasiao" },
    ],
    thaiWaterName: "ท่าจีน",
    isActive: true,
    status: "active",
  },
  {
    id: "mae-klong",
    slug: "mae-klong",
    code: "14",
    nameTh: "ลุ่มน้ำแม่กลอง",
    nameEn: "Mae Klong River Basin",
    descriptionTh: "ลุ่มน้ำแม่กลองครอบคลุมพื้นที่จังหวัดกาญจนบุรี ราชบุรี และสมุทรสงคราม",
    descriptionEn: "The Mae Klong River Basin covers Kanchanaburi, Ratchaburi, and Samut Songkhram provinces.",
    areaKm2: 30837,
    bgGradient: "from-emerald-950 via-slate-900 to-cyan-950",
    accentColor: "#10B981",
    center: [14.5, 99.1],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำแม่กลอง", en: "Mae Klong River" },
      { th: "แม่น้ำแควใหญ่", en: "Khwae Yai River" },
      { th: "แม่น้ำแควน้อย", en: "Khwae Noi River" },
      { th: "แม่น้ำภาชี", en: "Phachi River" },
    ],
    thaiWaterName: "แม่กลอง",
    isActive: true,
    status: "active",
  },
  {
    id: "bang-pakong",
    slug: "bang-pakong",
    code: "15",
    nameTh: "ลุ่มน้ำบางปะกง",
    nameEn: "Bang Pakong River Basin",
    descriptionTh: "ลุ่มน้ำบางปะกงครอบคลุมพื้นที่จังหวัดนครนายก ปราจีนบุรี สระแก้ว ฉะเชิงเทรา และชลบุรี",
    descriptionEn: "The Bang Pakong River Basin covers Nakhon Nayok, Prachin Buri, Sa Kaeo, Chachoengsao, and Chon Buri provinces.",
    areaKm2: 18512,
    bgGradient: "from-sky-950 via-slate-900 to-indigo-950",
    accentColor: "#38BDF8",
    center: [13.8, 101.5],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำบางปะกง", en: "Bang Pakong River" },
      { th: "แม่น้ำปราจีนบุรี", en: "Prachin Buri River" },
      { th: "แม่น้ำนครนายก", en: "Nakhon Nayok River" },
      { th: "แม่น้ำหนุมาน", en: "Hanuman River" },
      { th: "คลองพระปรง", en: "Khlong Phra Prong" },
    ],
    thaiWaterName: "บางปะกง",
    isActive: true,
    status: "active",
  },
  {
    id: "east-coast",
    slug: "east-coast",
    code: "17",
    nameTh: "ลุ่มน้ำชายฝั่งทะเลตะวันออก",
    nameEn: "East Coast River Basin",
    descriptionTh: "ลุ่มน้ำชายฝั่งทะเลตะวันออกครอบคลุมพื้นที่จังหวัดชลบุรี ระยอง จันทบุรี และตราด",
    descriptionEn: "The East Coast River Basin covers Chon Buri, Rayong, Chanthaburi, and Trat provinces.",
    areaKm2: 13854,
    bgGradient: "from-cyan-950 via-slate-900 to-blue-950",
    accentColor: "#06B6D4",
    center: [12.8, 101.7],
    zoom: 8,
    mainRivers: [
      { th: "แม่น้ำระยอง", en: "Rayong River" },
      { th: "แม่น้ำประแสร์", en: "Prasae River" },
      { th: "แม่น้ำจันทบุรี", en: "Chanthaburi River" },
      { th: "แม่น้ำเวฬุ", en: "Welu River" },
      { th: "แม่น้ำตราด", en: "Trat River" },
    ],
    thaiWaterName: "ชายฝั่งทะเลตะวันออก",
    isActive: true,
    status: "active",
  },
];

export const MASTER_BASINS_MAP: Record<string, MasterBasinConfig> = Object.fromEntries(
  MASTER_BASINS.map((b) => [b.slug, b])
);

/**
 * Ensures that the given basin slugs (or all MASTER_BASINS if undefined) exist in the PostgreSQL `basins` table.
 * If any basin is missing, it is inserted automatically.
 */
export async function ensureBasinsInDb(targetSlugs?: string[]) {
  const now = new Date();
  const slugsToCheck = targetSlugs && targetSlugs.length > 0
    ? targetSlugs
    : MASTER_BASINS.map((b) => b.slug);

  const existingBasins = await db.select().from(basins);
  const existingSlugs = new Set(existingBasins.map((b) => b.slug));

  for (const slug of slugsToCheck) {
    const config = MASTER_BASINS_MAP[slug];
    if (!config) continue;

    if (!existingSlugs.has(slug)) {
      console.log(`  🌱 Registering basin [${slug}] (${config.nameTh}) in PostgreSQL...`);
      await db
        .insert(basins)
        .values({
          id: config.id,
          slug: config.slug,
          code: config.code,
          nameTh: config.nameTh,
          nameEn: config.nameEn,
          descriptionTh: config.descriptionTh,
          descriptionEn: config.descriptionEn,
          areaKm2: config.areaKm2,
          isActive: config.isActive,
          status: config.status,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: basins.id,
          set: {
            nameTh: config.nameTh,
            nameEn: config.nameEn,
            code: config.code,
            descriptionTh: config.descriptionTh,
            descriptionEn: config.descriptionEn,
            areaKm2: config.areaKm2,
            isActive: config.isActive,
            updatedAt: now,
          },
        });
      existingSlugs.add(slug);
    }
  }

  // Return the queried basins for the requested slugs (or all active)
  return targetSlugs && targetSlugs.length > 0
    ? await db.select().from(basins).where(inArray(basins.slug, targetSlugs))
    : await db.select().from(basins);
}

/**
 * Checks if the basin has stations in DB; if not, automatically loads and imports
 * stations from `flood-analysis-model/dataset/<slug>/station/` if available.
 */
export async function ensureBasinStationsInDb(slug: string) {
  const [b] = await db.select().from(basins).where(eq(basins.slug, slug));
  if (!b) return;

  const existingWl = await db.select({ id: waterlevelStations.id }).from(waterlevelStations).where(eq(waterlevelStations.basinId, b.id));
  if (existingWl.length > 0) {
    return; // Already populated
  }

  const modelDir = getModelDatasetDir();
  if (!modelDir) return;

  const stationDir = join(modelDir, slug, "station");
  const { stationImporter } = await import("../services/stationImporterService");

  // Waterlevel stations
  const wlFile = join(stationDir, `${slug}_waterlevel_stations.json`);
  if (existsSync(wlFile)) {
    try {
      const data = JSON.parse(readFileSync(wlFile, "utf-8"));
      await stationImporter.importWaterlevelStations(data, slug, { skipR2: true });
      console.log(`  💧 Auto-imported ${data.length} waterlevel stations for [${slug}]`);
    } catch (e: any) {
      console.warn(`  ⚠️ Could not auto-import waterlevel stations for [${slug}]:`, e.message);
    }
  }

  // Rainfall stations
  const rainFile = join(stationDir, `${slug}_rain_stations.json`);
  if (existsSync(rainFile)) {
    try {
      const data = JSON.parse(readFileSync(rainFile, "utf-8"));
      await stationImporter.importRainfallStations(data, slug, { skipR2: true });
      console.log(`  🌧️ Auto-imported ${data.length} rainfall stations for [${slug}]`);
    } catch (e: any) {
      console.warn(`  ⚠️ Could not auto-import rainfall stations for [${slug}]:`, e.message);
    }
  }
}
