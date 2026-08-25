import { db } from "./index";
import { basins, stations, telemetryLatest } from "./schema";

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
    boundaryBBox: [99.45, 16.45, 100.42, 19.12],
    status: "active",
  },
  {
    id: "ping",
    slug: "ping",
    code: "05",
    nameTh: "ลุ่มน้ำปิง",
    nameEn: "Ping River Basin",
    descriptionTh: "ลุ่มน้ำปิงครอบคลุมพื้นที่จังหวัดเชียงใหม่ ลำพูน ตาก และกำแพงเพชร",
    descriptionEn: "The Ping River Basin covers Chiang Mai, Lamphun, Tak, and Kamphaeng Phet provinces.",
    areaKm2: 33898,
    boundaryBBox: [98.15, 15.75, 100.1, 19.8],
    status: "active",
  },
  {
    id: "wang",
    slug: "wang",
    code: "06",
    nameTh: "ลุ่มน้ำวัง",
    nameEn: "Wang River Basin",
    descriptionTh: "ลุ่มน้ำวังครอบคลุมพื้นที่จังหวัดลำปางและตาก",
    descriptionEn: "The Wang River Basin covers Lampang and Tak provinces.",
    areaKm2: 10792,
    boundaryBBox: [99.0, 16.8, 99.8, 19.0],
    status: "active",
  },
  {
    id: "nan",
    slug: "nan",
    code: "07",
    nameTh: "ลุ่มน้ำน่าน",
    nameEn: "Nan River Basin",
    descriptionTh: "ลุ่มน้ำน่านครอบคลุมพื้นที่จังหวัดน่าน อุตรดิตถ์ พิษณุโลก และพิจิตร",
    descriptionEn: "The Nan River Basin covers Nan, Uttaradit, Phitsanulok, and Phichit provinces.",
    areaKm2: 34330,
    boundaryBBox: [99.8, 15.8, 101.3, 19.6],
    status: "active",
  },
  {
    id: "chi",
    slug: "chi",
    code: "15",
    nameTh: "ลุ่มน้ำชี",
    nameEn: "Chi River Basin",
    descriptionTh: "ลุ่มน้ำชีครอบคลุมพื้นที่ภาคตะวันออกเฉียงเหนือตอนกลาง",
    descriptionEn: "The Chi River Basin covers central northeastern Thailand.",
    areaKm2: 49477,
    boundaryBBox: [101.2, 15.3, 104.5, 17.5],
    status: "active",
  },
  {
    id: "mun",
    slug: "mun",
    code: "16",
    nameTh: "ลุ่มน้ำมูล",
    nameEn: "Mun River Basin",
    descriptionTh: "ลุ่มน้ำมูลครอบคลุมพื้นที่ภาคตะวันออกเฉียงเหนือตอนล่าง",
    descriptionEn: "The Mun River Basin covers lower northeastern Thailand.",
    areaKm2: 70966,
    boundaryBBox: [101.4, 14.1, 105.6, 16.0],
    status: "active",
  },
  {
    id: "chao-phraya",
    slug: "chao-phraya",
    code: "09",
    nameTh: "ลุ่มน้ำเจ้าพระยา",
    nameEn: "Chao Phraya River Basin",
    descriptionTh: "ลุ่มน้ำสายหลักของภาคกลาง รองรับน้ำจาก ปิง วัง ยม น่าน",
    descriptionEn: "The main river basin of central Thailand, receiving flow from Ping, Wang, Yom, and Nan.",
    areaKm2: 20120,
    boundaryBBox: [99.8, 13.5, 100.9, 15.8],
    status: "active",
  },
];

export const initialStations = [
  // Yom Basin Stations
  {
    id: "8892",
    code: "Y-0014",
    basinId: "yom",
    type: "water_level",
    lat: 17.661658,
    lon: 99.684676,
    nameTh: "บ้านโป่งวัว",
    nameEn: "Ban Pong Wua",
    addressTh: "ต.สารจิตร อ.ศรีสัชนาลัย จ.สุโขทัย",
    addressEn: "Sarachit, Si Satchanalai, Sukhothai",
    agencyNameTh: "กรมชลประทาน",
    agencyNameEn: "Royal Irrigation Department (RID)",
    riverNameTh: "แม่น้ำยม",
    riverNameEn: "Yom River",
    groundLevelMsl: 52.0,
    bankLevelMsl: 6.5,
    warningLevelMsl: 5.8,
    criticalLevelMsl: 6.2,
    warningRain24h: null,
    criticalRain24h: null,
    source: "thaiwater",
    sourceStationId: "8892",
    status: "active",
  },
  {
    id: "133528",
    code: "P-001",
    basinId: "yom",
    type: "rainfall",
    lat: 17.5123,
    lon: 99.8142,
    nameTh: "สถานีวัดน้ำฝนศรีสัชนาลัย",
    nameEn: "Si Satchanalai Rain Station",
    addressTh: "ต.หาดเสี้ยว อ.ศรีสัชนาลัย จ.สุโขทัย",
    addressEn: "Hat Siao, Si Satchanalai, Sukhothai",
    agencyNameTh: "กรมอุตุนิยมวิทยา",
    agencyNameEn: "Thai Meteorological Department (TMD)",
    riverNameTh: "ลุ่มน้ำยม",
    riverNameEn: "Yom Basin",
    groundLevelMsl: null,
    bankLevelMsl: null,
    warningLevelMsl: null,
    criticalLevelMsl: null,
    warningRain24h: 35.0,
    criticalRain24h: 90.0,
    source: "thaiwater",
    sourceStationId: "133528",
    status: "active",
  },
  {
    id: "Y-0020",
    code: "Y-0020",
    basinId: "yom",
    type: "water_level",
    lat: 17.0042,
    lon: 99.8251,
    nameTh: "สะพานพระแม่ย่า (เมืองสุโขทัย)",
    nameEn: "Phra Mae Ya Bridge (Sukhothai City)",
    addressTh: "ต.ธานี อ.เมือง จ.สุโขทัย",
    addressEn: "Thani, Mueang Sukhothai, Sukhothai",
    agencyNameTh: "กรมชลประทาน",
    agencyNameEn: "Royal Irrigation Department (RID)",
    riverNameTh: "แม่น้ำยม",
    riverNameEn: "Yom River",
    groundLevelMsl: 44.0,
    bankLevelMsl: 7.45,
    warningLevelMsl: 6.8,
    criticalLevelMsl: 7.2,
    warningRain24h: null,
    criticalRain24h: null,
    source: "thaiwater",
    sourceStationId: "Y-0020",
    status: "active",
  },
  {
    id: "Y-0035",
    code: "Y-0035",
    basinId: "yom",
    type: "rainfall",
    lat: 16.8214,
    lon: 99.9812,
    nameTh: "สถานีวัดน้ำฝนกงไกรลาศ",
    nameEn: "Kong Krailat Rain Station",
    addressTh: "ต.กง อ.กงไกรลาศ จ.สุโขทัย",
    addressEn: "Kong, Kong Krailat, Sukhothai",
    agencyNameTh: "กรมทรัพยากรน้ำ",
    agencyNameEn: "Department of Water Resources (DWR)",
    riverNameTh: "ลุ่มน้ำยม",
    riverNameEn: "Yom Basin",
    groundLevelMsl: null,
    bankLevelMsl: null,
    warningLevelMsl: null,
    criticalLevelMsl: null,
    warningRain24h: 35.0,
    criticalRain24h: 90.0,
    source: "thaiwater",
    sourceStationId: "Y-0035",
    status: "active",
  },
  // Ping Basin Stations
  {
    id: "P-1001",
    code: "P-1001",
    basinId: "ping",
    type: "water_level",
    lat: 18.7883,
    lon: 99.0032,
    nameTh: "สะพานนวรัฐ (P.1)",
    nameEn: "Nawarat Bridge (P.1)",
    addressTh: "ต.ช้างม่อย อ.เมือง จ.เชียงใหม่",
    addressEn: "Chang Moi, Mueang Chiang Mai, Chiang Mai",
    agencyNameTh: "กรมชลประทาน",
    agencyNameEn: "Royal Irrigation Department (RID)",
    riverNameTh: "แม่น้ำปิง",
    riverNameEn: "Ping River",
    groundLevelMsl: 300.0,
    bankLevelMsl: 3.7,
    warningLevelMsl: 3.2,
    criticalLevelMsl: 3.5,
    warningRain24h: null,
    criticalRain24h: null,
    source: "thaiwater",
    sourceStationId: "P-1001",
    status: "active",
  },
  // Chao Phraya Basin Stations
  {
    id: "CP-0013",
    code: "CP-0013",
    basinId: "chao-phraya",
    type: "water_level",
    lat: 15.1583,
    lon: 100.1812,
    nameTh: "เขื่อนเจ้าพระยา (C.13)",
    nameEn: "Chao Phraya Dam (C.13)",
    addressTh: "ต.บางหลวง อ.สรรพยา จ.ชัยนาท",
    addressEn: "Bang Luang, Sapphaya, Chai Nat",
    agencyNameTh: "กรมชลประทาน",
    agencyNameEn: "Royal Irrigation Department (RID)",
    riverNameTh: "แม่น้ำเจ้าพระยา",
    riverNameEn: "Chao Phraya River",
    groundLevelMsl: 14.0,
    bankLevelMsl: 17.5,
    warningLevelMsl: 16.5,
    criticalLevelMsl: 17.0,
    warningRain24h: null,
    criticalRain24h: null,
    source: "thaiwater",
    sourceStationId: "CP-0013",
    status: "active",
  },
];

export const initialStationRelations = [
  {
    stationId: "8892",
    targetStationId: "133528",
    relationType: "rainfall_influence",
    distanceKm: 32.0,
    travelTimeHours: 4.5,
    influenceWeightPercent: 40.0,
    isUpstream: true,
  },
  {
    stationId: "8892",
    targetStationId: "Y-0020",
    relationType: "downstream_gauge",
    distanceKm: 54.0,
    travelTimeHours: 8.0,
    influenceWeightPercent: 85.0,
    isUpstream: false,
  },
  {
    stationId: "Y-0020",
    targetStationId: "133528",
    relationType: "rainfall_influence",
    distanceKm: 86.0,
    travelTimeHours: 12.5,
    influenceWeightPercent: 30.0,
    isUpstream: true,
  },
];

export async function seedDatabase() {
  console.log("🌱 Seeding Water Situation Platform Master Registry...");
  const now = new Date();

  try {
    const { stationRelations } = await import("./schema");
    // 1. Seed Basins
    for (const b of initialBasins) {
      await db
        .insert(basins)
        .values({
          id: b.id,
          slug: b.slug,
          code: b.code,
          nameTh: b.nameTh,
          nameEn: b.nameEn,
          descriptionTh: b.descriptionTh,
          descriptionEn: b.descriptionEn,
          areaKm2: b.areaKm2,
          boundaryBBox: b.boundaryBBox as any,
          status: b.status,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: basins.id,
          set: {
            nameTh: b.nameTh,
            nameEn: b.nameEn,
            areaKm2: b.areaKm2,
            updatedAt: now,
          },
        });
    }
    console.log(`✅ Seeded ${initialBasins.length} River Basins`);

    // 2. Seed Stations
    for (const s of initialStations) {
      await db
        .insert(stations)
        .values({
          id: s.id,
          code: s.code,
          basinId: s.basinId,
          type: s.type,
          lat: s.lat,
          lon: s.lon,
          nameTh: s.nameTh,
          nameEn: s.nameEn,
          addressTh: s.addressTh,
          addressEn: s.addressEn,
          agencyNameTh: s.agencyNameTh,
          agencyNameEn: s.agencyNameEn,
          riverNameTh: s.riverNameTh,
          riverNameEn: s.riverNameEn,
          groundLevelMsl: s.groundLevelMsl,
          bankLevelMsl: s.bankLevelMsl,
          warningLevelMsl: s.warningLevelMsl,
          criticalLevelMsl: s.criticalLevelMsl,
          warningRain24h: s.warningRain24h,
          criticalRain24h: s.criticalRain24h,
          source: s.source,
          sourceStationId: s.sourceStationId,
          status: s.status,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: stations.id,
          set: {
            lat: s.lat,
            lon: s.lon,
            nameTh: s.nameTh,
            nameEn: s.nameEn,
            bankLevelMsl: s.bankLevelMsl,
            warningLevelMsl: s.warningLevelMsl,
            criticalLevelMsl: s.criticalLevelMsl,
            updatedAt: now,
          },
        });

      // Insert baseline telemetry
      await db
        .insert(telemetryLatest)
        .values({
          stationId: s.id,
          basinId: s.basinId,
          timestamp: now,
          stage: s.type === "water_level" ? 4.01 : null,
          discharge: s.type === "water_level" ? 180.0 : null,
          waterLevelMsl: s.type === "water_level" ? 48.5 : null,
          storagePercent: s.type === "water_level" ? 65.0 : null,
          rainfall1h: s.type === "rainfall" ? 0.0 : null,
          rainfall24h: s.type === "rainfall" ? 12.5 : null,
          rainfallToday: s.type === "rainfall" ? 8.0 : null,
          trend: "rising",
          situationStatus: "watch",
          freshnessStatus: "fresh",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: telemetryLatest.stationId,
          set: {
            timestamp: now,
            trend: "rising",
            situationStatus: "watch",
            freshnessStatus: "fresh",
            updatedAt: now,
          },
        });
    }

    // 3. Seed Station Relations
    for (const r of initialStationRelations) {
      await db.insert(stationRelations).values({
        stationId: r.stationId,
        targetStationId: r.targetStationId,
        relationType: r.relationType,
        distanceKm: r.distanceKm,
        travelTimeHours: r.travelTimeHours,
        influenceWeightPercent: r.influenceWeightPercent,
        isUpstream: r.isUpstream,
        updatedAt: now,
      });
    }

    console.log(`✅ Seeded ${initialStations.length} Stations & ${initialStationRelations.length} Station Relations`);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  }
}

if (import.meta.main) {
  seedDatabase().then(() => process.exit(0));
}

