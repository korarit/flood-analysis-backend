import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./index";
import { basins, rainfallStations, stationRelations, telemetryLatest, waterlevelStations } from "./schema";
import { stationImporter } from "../services/stationImporterService";

export const initialBasins = [
  {
    id: "yom",
    slug: "yom",
    code: "08",
    nameTh: "ลุ่มน้ำยม",
    nameEn: "Yom River Basin",
    descriptionTh: "ลุ่มน้ำยมครอบคลุมพื้นที่จังหวัดพะเยา แพร่ สุโขทัย พิษณุโลก และพิจิตร",
    descriptionEn: "The Yom River Basin covers Phayao, Phrae, Sukhothai, Phitsanulok, and Phichit provinces.",
    areaKm2: 23616,
    boundaryGeojsonPath: null, // null หมายถึงยังไม่ได้ upload ไฟล์ geojson
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
    boundaryGeojsonPath: null,
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
    boundaryGeojsonPath: null,
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
    boundaryGeojsonPath: null,
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
    boundaryGeojsonPath: null,
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
    boundaryGeojsonPath: null,
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
    boundaryGeojsonPath: null,
    isActive: true,
    status: "active",
  },
  {
    id: "chao-phraya",
    slug: "chao-phraya",
    code: "10",
    nameTh: "ลุ่มน้ำเจ้าพระยา",
    nameEn: "Chao Phraya River Basin",
    descriptionTh: "ลุ่มน้ำสายหลักของภาคกลาง รองรับน้ำจาก ปิง วัง ยม น่าน",
    descriptionEn: "The main river basin of central Thailand, receiving flow from Ping, Wang, Yom, and Nan.",
    areaKm2: 20120,
    boundaryGeojsonPath: null,
    isActive: true,
    status: "active",
  },
];

export async function seedDatabase() {
  console.log("🌱 Starting Database Seeding...");

  try {
    const now = new Date();

    // 1. Seed Basins
    for (const b of initialBasins) {
      await db
        .insert(basins)
        .values({
          ...b,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: basins.id,
          set: {
            nameTh: b.nameTh,
            nameEn: b.nameEn,
            isActive: b.isActive,
            updatedAt: now,
          },
        });
    }
    console.log(`✅ Seeded ${initialBasins.length} Basins`);

    // 2. Check if flood-analysis-model/dataset exists to auto-import rich station files
    const modelDatasetDir = join(process.cwd(), "..", "flood-analysis-model", "dataset");
    if (existsSync(modelDatasetDir)) {
      console.log(`📂 Found model dataset directory at ${modelDatasetDir}, importing stations...`);
      const basinFolders = readdirSync(modelDatasetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const slug of basinFolders) {
        const stationDir = join(modelDatasetDir, slug, "station");
        const processedDir = join(modelDatasetDir, slug, "processed");

        // Waterlevel
        const wlFile = join(stationDir, `${slug}_waterlevel_stations.json`);
        if (existsSync(wlFile)) {
          const data = JSON.parse(readFileSync(wlFile, "utf-8"));
          await stationImporter.importWaterlevelStations(data, `${slug}_waterlevel_stations.json`);
        }

        // Rainfall
        const rainFile = join(stationDir, `${slug}_rain_stations.json`);
        if (existsSync(rainFile)) {
          const data = JSON.parse(readFileSync(rainFile, "utf-8"));
          await stationImporter.importRainfallStations(data, `${slug}_rain_stations.json`);
        }

        // Relations (Prioritize relations_frontend.json)
        const relFrontend = join(processedDir, "relations_frontend.json");
        const relWaterlevel = join(processedDir, "relation_waterlevel_frontend.json");
        const relFile = existsSync(relFrontend) ? relFrontend : existsSync(relWaterlevel) ? relWaterlevel : null;
        if (relFile) {
          const data = JSON.parse(readFileSync(relFile, "utf-8"));
          await stationImporter.importRelations(data, slug);
        }
      }
      console.log("✅ Finished importing stations and relations from dataset folders");
    }

    console.log("🎉 Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  }
}

if (import.meta.main) {
  seedDatabase().then(() => process.exit(0));
}
