import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { basins, ingestionJobs } from "../db/schema";
import { r2Publisher } from "../services/r2PublisherService";
import { thaiWaterIngestion } from "../services/thaiWaterIngestion";

/**
 * CLI Scraper & Telemetry Sync Runner
 * Usage:
 *   bun run sync                      # Sync all active basins
 *   bun run sync yom                  # Sync specific basin by slug
 *   bun run sync --basin=yom          # Sync specific basin with flag
 *   bun run sync --full               # Sync telemetry + full R2 rebuild
 *   bun run scraper                   # Alias for scraper runner
 */
async function run() {
  const args = process.argv.slice(2);

  let targetBasin: string | undefined = undefined;
  let isFullRebuild = false;

  for (const arg of args) {
    if (arg.startsWith("--basin=")) {
      const val = arg.split("=")[1]?.trim();
      targetBasin = val?.toLowerCase() === "all" ? undefined : val;
    } else if (arg === "--full" || arg === "--all-rebuild") {
      isFullRebuild = true;
    } else if (arg === "--all" || arg.toLowerCase() === "all") {
      targetBasin = undefined;
    } else if (!arg.startsWith("--")) {
      const val = arg.trim();
      targetBasin = val.toLowerCase() === "all" ? undefined : val;
    }
  }

  const startTime = new Date();
  console.log("===============================================================");
  console.log("🌊 WATER SITUATION PLATFORM — TELEMETRY SCRAPER & SYNC");
  console.log("===============================================================");
  console.log(`⏰ Started at:       ${startTime.toLocaleString("th-TH")}`);
  console.log(`🎯 Target Basin:     ${targetBasin || "All Active Basins"}`);
  console.log(`📦 Mode:             ${isFullRebuild ? "Sync Telemetry + Full R2 Rebuild" : "Sync Telemetry + Live R2 Overwrite"}`);
  console.log("---------------------------------------------------------------\n");

  // Validate basin if provided
  if (targetBasin) {
    const existing = await db.select().from(basins).where(eq(basins.slug, targetBasin)).limit(1);
    if (!existing.length) {
      console.error(`❌ Error: Basin '${targetBasin}' not found in database!`);
      const allBasins = await db.select({ slug: basins.slug, name: basins.nameTh }).from(basins);
      console.log("Available basins:", allBasins.map(b => `${b.slug} (${b.name})`).join(", "));
      process.exit(1);
    }
  }

  // Record ingestion job in database
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      jobType: isFullRebuild ? "sync_all" : "sync_telemetry",
      basinId: targetBasin || "all",
      status: "running",
      recordsProcessed: 0,
      startedAt: startTime,
    })
    .returning();

  console.log(`📋 Ingestion Job #${job.id} registered in PostgreSQL.`);
  console.log("⏳ Scraping ThaiWater telemetry, computing metrics, and syncing R2...\n");

  try {
    // 1. Run Telemetry Ingestion from ThaiWater
    const syncRes = await thaiWaterIngestion.syncAllTelemetry(targetBasin);

    let r2Summary = { basinsCount: 0, stationsCount: 0 };
    if (isFullRebuild) {
      console.log("📦 Rebuilding all R2 Datasets (overview, stations, spatial, bulletins)...");
      const pubRes = await r2Publisher.rebuildAllDatasets(targetBasin);
      r2Summary = { basinsCount: pubRes.basinsCount, stationsCount: pubRes.stationsCount };
    }

    const endTime = new Date();
    const durationSec = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2);

    // 2. Mark job as completed
    await db
      .update(ingestionJobs)
      .set({
        status: "completed",
        recordsProcessed: syncRes.synced,
        finishedAt: endTime,
      })
      .where(eq(ingestionJobs.id, job.id));

    console.log("\n===============================================================");
    console.log("🎉 SCRAPE & SYNC COMPLETED SUCCESSFULLY!");
    console.log("===============================================================");
    console.log(`⏱️ Duration:            ${durationSec} seconds`);
    console.log(`📊 Total Stations:      ${syncRes.total}`);
    console.log(`✅ Stations Synced:     ${syncRes.synced}`);
    console.log(`⚠️ Stations Inactive:   ${syncRes.failed}`);
    if (isFullRebuild) {
      console.log(`📦 R2 Basins Published: ${r2Summary.basinsCount}`);
      console.log(`📦 R2 Stations Snapshot:${r2Summary.stationsCount}`);
    }
    if (syncRes.errors.length > 0) {
      console.log(`⚠️ Errors encountered:  ${syncRes.errors.length}`);
      console.log("Sample errors:", syncRes.errors.slice(0, 3));
    }
    console.log("===============================================================\n");

    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ Scrape/Sync job failed:", err.message);

    await db
      .update(ingestionJobs)
      .set({
        status: "failed",
        errors: { message: err.message, stack: err.stack },
        finishedAt: new Date(),
      })
      .where(eq(ingestionJobs.id, job.id));

    process.exit(1);
  }
}

run();
