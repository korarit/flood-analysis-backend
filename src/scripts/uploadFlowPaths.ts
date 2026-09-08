import { existsSync, statSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins } from "../db/schema";
import { getModelDatasetDir } from "../config/paths";
import { r2Publisher } from "../services/r2PublisherService";

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
  console.log("🌊 WATER SITUATION PLATFORM — BASIN FLOW PATHS UPLOADER & SYNC");
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
    console.warn(`⚠️ Model dataset directory not found or not configured.`);
  }

  const summary: Array<{
    id: string;
    slug: string;
    nameTh: string;
    status: "success" | "skipped" | "failed";
    source: string;
    features: number;
    sizeKb: string;
    r2Path?: string;
    error?: string;
  }> = [];

  for (const b of allBasins) {
    console.log(`\n🔹 Processing Basin: [${b.slug.toUpperCase()}] ${b.nameTh}`);

    const modelFile = r2Publisher.getModelFlowPathsPath(b.slug);
    if (!modelFile || !existsSync(modelFile.path)) {
      console.warn(`  ⚠️ No flow_paths.geojson(.gz) found for basin '${b.slug}' in model folder.`);
      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "skipped",
        source: "not_found",
        features: 0,
        sizeKb: "0",
        error: "flow_paths file not found in model",
      });
      continue;
    }

    try {
      const stat = statSync(modelFile.path);
      const sizeKb = (stat.size / 1024).toFixed(1);
      console.log(`  📁 Found local flow path file: ${modelFile.path} (${sizeKb} KB, isGzip: ${modelFile.isGzip})`);

      const pubRes = await r2Publisher.publishBasinFlowPaths(b.slug);
      console.log(`  ✅ Uploaded to R2: ${pubRes.r2Path} (ETag: ${pubRes.etag || "local-mirror"})`);
      console.log(`  📊 Features count: ${pubRes.featuresCount.toLocaleString()} flow path lines`);
      console.log(`  💾 Updated DB: basins.flow_paths_geojson_path = '${pubRes.r2Path}'`);

      summary.push({
        id: b.id,
        slug: b.slug,
        nameTh: b.nameTh,
        status: "success",
        source: pubRes.source,
        features: pubRes.featuresCount,
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
        source: modelFile.path,
        features: 0,
        sizeKb: "0",
        error: err.message,
      });
    }
  }

  console.log("\n===================================================================");
  console.log("📊 BASIN FLOW PATHS UPLOAD SUMMARY");
  console.log("===================================================================");
  console.table(
    summary.map((s) => ({
      Basin: `${s.slug} (${s.nameTh})`,
      Status: s.status === "success" ? "✅ Success" : s.status === "skipped" ? "⚠️ Skipped" : "❌ Failed",
      Features: s.features ? s.features.toLocaleString() : "-",
      Size: s.sizeKb,
      R2Path: s.r2Path || s.error || "-",
    }))
  );

  const totalSuccess = summary.filter((s) => s.status === "success").length;
  console.log(`\n🎉 Completed: ${totalSuccess} / ${summary.length} basin flow paths uploaded and updated in DB.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error during basin flow paths upload:", err);
  process.exit(1);
});
