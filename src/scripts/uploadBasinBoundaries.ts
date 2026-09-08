import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins } from "../db/schema";
import { getModelDatasetDir } from "../config/paths";
import { r2Publisher } from "../services/r2PublisherService";

// Mapping of basin slug to ThaiWater Thai Name for fallback online downloader
const THAIWATER_BASIN_NAMES: Record<string, string> = {
  yom: "ยม",
  ping: "ปิง",
  wang: "วัง",
  nan: "น่าน",
  chi: "ชี",
  mun: "มูล",
  "khong-north": "โขงเหนือ",
  "chao-phraya": "เจ้าพระยา",
  "pa-sak": "ป่าสัก",
  salawin: "สาละวิน",
  "khong-ne": "โขงตะวันออกเฉียงเหนือ",
  sakaekrang: "สะแกกรัง",
  "tha-chin": "ท่าจีน",
  "mae-klong": "แม่กลอง",
  "bang-pakong": "บางปะกง",
  "tonle-sap": "โตนเลสาป",
  "east-coast": "ชายฝั่งทะเลตะวันออก",
  phetchaburi: "เพชรบุรี-ประจวบคีรีขันธ์",
  "south-east-upper": "ภาคใต้ฝั่งตะวันออกตอนบน",
  "songkhla-lake": "ทะเลสาบสงขลา",
  "south-east-lower": "ภาคใต้ฝั่งตะวันออกตอนล่าง",
  "south-west": "ภาคใต้ฝั่งตะวันตก",
};

/**
 * Counts vertices in a GeoJSON geometry
 */
function countVertices(geometry: any): number {
  if (!geometry || !geometry.coordinates) return 0;
  const coords = geometry.coordinates;

  if (geometry.type === "Polygon") {
    return coords.reduce((acc: number, ring: any[]) => acc + ring.length, 0);
  }
  if (geometry.type === "MultiPolygon") {
    return coords.reduce(
      (acc: number, poly: any[][]) =>
        acc + poly.reduce((subAcc: number, ring: any[]) => subAcc + ring.length, 0),
      0
    );
  }
  return 0;
}

/**
 * Fetch official boundary for a basin from ThaiWater open API
 */
async function fetchThaiWaterBoundary(slug: string): Promise<any | null> {
  const targetName = THAIWATER_BASIN_NAMES[slug] || slug;
  console.log(`  🌐 Fetching boundary for '${slug}' (${targetName}) from ThaiWater API...`);

  try {
    const res = await fetch("https://www.thaiwater.net/json/boundary/basin.json");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const features = data.features || [];

    const matched = features.find((f: any) => {
      const bName = f.properties?.BASIN_T?.trim();
      return bName === targetName || (targetName && bName?.includes(targetName));
    });

    if (!matched || !matched.geometry) {
      console.warn(`  ⚠️ No matching feature in ThaiWater for '${slug}'`);
      return null;
    }

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            basin_slug: slug,
            basin_name_th: `ลุ่มน้ำ${matched.properties?.BASIN_T?.replace(/^ลุ่มน้ำ/, "")}`,
            source: "ThaiWater (HII Official)",
            basin_code: matched.properties?.BASIN_CODE,
          },
          geometry: matched.geometry,
        },
      ],
    };
  } catch (err: any) {
    console.warn(`  ⚠️ Failed to fetch boundary from ThaiWater API:`, err.message);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let targetBasin: string | undefined = undefined;

  for (const arg of args) {
    if (arg.startsWith("--basin=")) {
      const val = arg.split("=")[1]?.trim();
      targetBasin = val?.toLowerCase() === "all" ? undefined : val;
    } else if (arg === "--all" || arg.toLowerCase() === "all") {
      targetBasin = undefined;
    } else if (!arg.startsWith("--")) {
      const val = arg.trim();
      targetBasin = val.toLowerCase() === "all" ? undefined : val;
    }
  }

  console.log("===================================================================");
  console.log("🌊 WATER SITUATION PLATFORM — BASIN BORDER UPLOADER & SYNC");
  console.log("===================================================================");
  console.log(`⏰ Started at:       ${new Date().toLocaleString("th-TH")}`);
  console.log(`🎯 Target:           ${targetBasin ? `Basin '${targetBasin}'` : "All Basins"}`);
  console.log("-------------------------------------------------------------------\n");

  const allBasins = targetBasin
    ? await db.select().from(basins).where(eq(basins.slug, targetBasin))
    : await db.select().from(basins);

  if (allBasins.length === 0) {
    console.error(`❌ No matching basins found in database!`);
    process.exit(1);
  }

  const modelDir = getModelDatasetDir();
  if (modelDir) {
    console.log(`📂 Found model dataset directory: ${modelDir}`);
  } else {
    console.warn(`⚠️ Model dataset directory not found or not configured. Will use ThaiWater API fallback.`);
  }

  const summary: Array<{
    id: string;
    slug: string;
    nameTh: string;
    status: "success" | "failed";
    source: string;
    vertices: number;
    sizeKb: string;
    r2Path?: string;
    error?: string;
  }> = [];

  for (const b of allBasins) {
    console.log(`\n🔹 Processing Basin: [${b.slug.toUpperCase()}] ${b.nameTh}`);

    let geoJsonData: any = null;
    let source = "unknown";
    let filePath: string | null = null;

    // 1. Try finding local file in flood-analysis-model
    if (modelDir) {
      const basinGisDir = join(modelDir, b.slug, "gis");
      const expectedFile = join(basinGisDir, `${b.slug}_boundary.geojson`);

      if (existsSync(expectedFile)) {
        filePath = expectedFile;
      } else if (existsSync(basinGisDir)) {
        try {
          const files = readdirSync(basinGisDir);
          const candidate = files.find((f) => f.endsWith("_boundary.geojson") || f === "boundary.geojson");
          if (candidate) {
            filePath = join(basinGisDir, candidate);
          }
        } catch {
          // ignore
        }
      }

      if (filePath && existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf-8");
          geoJsonData = JSON.parse(content);
          source = `model:${filePath}`;
          console.log(`  📁 Found local boundary file: ${filePath}`);
        } catch (err: any) {
          console.warn(`  ⚠️ Failed to parse local file: ${err.message}`);
        }
      }
    }

    // 2. Fallback: fetch directly from ThaiWater API
    if (!geoJsonData) {
      geoJsonData = await fetchThaiWaterBoundary(b.slug);
      if (geoJsonData) {
        source = "thaiwater_api";
        // Also cache to model dataset if directory exists
        if (modelDir) {
          try {
            const saveDir = join(modelDir, b.slug, "gis");
            if (!existsSync(saveDir)) {
              mkdirSync(saveDir, { recursive: true });
            }
            const savePath = join(saveDir, `${b.slug}_boundary.geojson`);
            writeFileSync(savePath, JSON.stringify(geoJsonData, null, 2), "utf-8");
            console.log(`  💾 Cached boundary to model: ${savePath}`);
          } catch (writeErr) {
            console.warn(`  ⚠️ Could not cache to model folder:`, writeErr);
          }
        }
      }
    }

    if (!geoJsonData) {
      console.error(`  ❌ Failed to obtain boundary GeoJSON for '${b.slug}'`);
      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "failed",
        source: "not_found",
        vertices: 0,
        sizeKb: "0",
        error: "Boundary GeoJSON not found in model or ThaiWater API",
      });
      continue;
    }

    // 3. Validate GeoJSON structure
    const isFC = geoJsonData.type === "FeatureCollection" && Array.isArray(geoJsonData.features);
    const isF = geoJsonData.type === "Feature" && geoJsonData.geometry;

    if (!isFC && !isF) {
      console.error(`  ❌ Invalid GeoJSON structure (must be FeatureCollection or Feature)`);
      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "failed",
        source,
        vertices: 0,
        sizeKb: "0",
        error: "Invalid GeoJSON structure",
      });
      continue;
    }

    const firstGeom = isFC ? geoJsonData.features[0]?.geometry : geoJsonData.geometry;
    const vertexCount = countVertices(firstGeom);
    const sizeBytes = Buffer.byteLength(JSON.stringify(geoJsonData));
    const sizeKb = (sizeBytes / 1024).toFixed(1);

    // 4. Upload to R2 and update PostgreSQL
    try {
      const pubRes = await r2Publisher.publishBasinBoundary(b.slug, geoJsonData);
      console.log(`  ✅ Uploaded to R2: ${pubRes.r2Path} (ETag: ${pubRes.etag || "local-mirror"})`);
      console.log(`  💾 Updated DB: basins.boundary_geojson_path = '${pubRes.r2Path}'`);

      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "success",
        source,
        vertices: vertexCount,
        sizeKb: `${sizeKb} KB`,
        r2Path: pubRes.r2Path,
      });
    } catch (err: any) {
      console.error(`  ❌ Failed to upload / update DB:`, err.message);
      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "failed",
        source,
        vertices: vertexCount,
        sizeKb: `${sizeKb} KB`,
        error: err.message,
      });
    }
  }

  // Print Summary Table
  console.log("\n===================================================================");
  console.log("📊 BASIN BORDER UPLOAD SUMMARY");
  console.log("===================================================================");
  console.table(
    summary.map((s) => ({
      Slug: s.slug,
      Basin: s.nameTh,
      Status: s.status === "success" ? "✅ SUCCESS" : "❌ FAILED",
      Vertices: s.vertices,
      Size: s.sizeKb,
      R2_Key: s.r2Path || s.error || "-",
    }))
  );

  const totalSuccess = summary.filter((s) => s.status === "success").length;
  console.log(`\n🎉 Completed: ${totalSuccess} / ${summary.length} basin borders uploaded and updated.`);

  process.exit(totalSuccess === summary.length ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error during basin border upload:", err);
  process.exit(1);
});
