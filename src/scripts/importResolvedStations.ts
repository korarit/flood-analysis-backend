import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { db, queryClient } from "../db";
import { basins, rainfallStations, stationRelations, waterlevelStations, telemetryLatest } from "../db/schema";
import { StationImporterService } from "../services/stationImporterService";
import { eq, sql } from "drizzle-orm";

async function main() {
  console.log("========================================================");
  console.log("  IMPORTING CLEANED STATIONS (NO DWR WATERLEVEL) & RELATIONS");
  console.log("========================================================");

  const importer = new StationImporterService();
  const modelDatasetDir = resolve(__dirname, "../../../flood-analysis-model/dataset");

  const targetBasins = ["yom", "ping", "nan", "wang", "chao-phraya", "chi", "khong-north", "mun", "pa-sak"];

  let totalWaterlevelImported = 0;
  let totalRainfallImported = 0;
  let totalRelationsImported = 0;

  for (const slug of targetBasins) {
    const basinDir = resolve(modelDatasetDir, slug);
    const wlJsonPath = resolve(basinDir, `station/${slug}_waterlevel_stations.json`);
    const rainJsonPath = resolve(basinDir, `station/${slug}_rain_stations.json`);
    const relJsonPath = resolve(basinDir, `processed/relations_frontend.json`);

    console.log(`\n--- Processing Basin: ${slug.toUpperCase()} ---`);
    
    // 1. Resolve basin from DB
    let basinInfo;
    try {
      basinInfo = await importer.resolveBasin(null, slug);
    } catch (err: any) {
      console.warn(`  ⚠️ Could not resolve basin ${slug} in DB:`, err.message);
      continue;
    }

    // 2. Load and Import Cleaned Waterlevel Stations (DWR removed)
    if (existsSync(wlJsonPath)) {
      try {
        const wlData = JSON.parse(readFileSync(wlJsonPath, "utf-8"));
        console.log(`  Loaded ${wlData.length} stations from ${slug}_waterlevel_stations.json`);

        // Purge old waterlevel stations for this basin
        await db.delete(waterlevelStations).where(eq(waterlevelStations.basinId, basinInfo.id));
        console.log(`  Purged old waterlevel stations for basin ${slug}`);

        const wlResult = await importer.importWaterlevelStations(wlData, slug);
        console.log(`  ✅ Imported ${wlResult.insertedOrUpdated} / ${wlResult.total} waterlevel stations`);
        totalWaterlevelImported += wlResult.insertedOrUpdated;
      } catch (err: any) {
        console.error(`  ❌ Failed to import waterlevel stations for ${slug}:`, err.message);
      }
    } else {
      console.log(`  [SKIP WL] No waterlevel file at ${wlJsonPath}`);
    }

    // 3. Load and Import Resolved Rain Stations
    if (existsSync(rainJsonPath)) {
      try {
        const rainData = JSON.parse(readFileSync(rainJsonPath, "utf-8"));
        console.log(`  Loaded ${rainData.length} stations from ${slug}_rain_stations.json`);

        // Clean old rainfall stations for this basin
        await db.delete(rainfallStations).where(eq(rainfallStations.basinId, basinInfo.id));
        console.log(`  Purged old rainfall stations for basin ${slug}`);

        const rainResult = await importer.importRainfallStations(rainData, slug);
        console.log(`  ✅ Imported ${rainResult.insertedOrUpdated} / ${rainResult.total} rainfall stations`);
        totalRainfallImported += rainResult.insertedOrUpdated;
        if (rainResult.errors.length > 0) {
          console.warn(`     ⚠️ Errors (${rainResult.errors.length}):`, rainResult.errors.slice(0, 3));
        }
      } catch (err: any) {
        console.error(`  ❌ Failed to import rainfall stations for ${slug}:`, err.message);
      }
    } else {
      console.log(`  [SKIP RAIN] No rainfall station file found at ${rainJsonPath}`);
    }

    // 4. Load and Import Relations (if present)
    if (existsSync(relJsonPath)) {
      try {
        const relData = JSON.parse(readFileSync(relJsonPath, "utf-8"));
        console.log(`  Loaded ${relData.length} relations from relations_frontend.json`);
        
        // Clean old relations for this basin
        // Relations reference stations from this basin
        const relResult = await importer.importRelations(relData, slug);
        console.log(`  ✅ Imported ${relResult.inserted} / ${relResult.total} relations`);
        totalRelationsImported += relResult.inserted;
      } catch (err: any) {
        console.error(`  ❌ Failed to import relations for ${slug}:`, err.message);
      }
    }
  }

  // 5. Cleanup Orphaned Telemetry for deleted stations
  console.log("\n--- Cleaning Orphaned Telemetry in Database ---");
  const purgeResult = await db.execute(sql`
    DELETE FROM telemetry_latest
    WHERE station_id NOT IN (
      SELECT id FROM waterlevel_stations
      UNION
      SELECT id FROM rainfall_stations
    );
  `);
  console.log(`  ✅ Purged orphaned telemetry records`);

  // Summary counts
  const wlCount = await db.execute(sql`SELECT count(*)::int as count FROM waterlevel_stations;`);
  const rainCount = await db.execute(sql`SELECT count(*)::int as count FROM rainfall_stations;`);
  const teleCount = await db.execute(sql`SELECT count(*)::int as count FROM telemetry_latest;`);

  console.log("\n========================================================");
  console.log("  [COMPLETE] All stations & relations updated in DB!");
  console.log(`  📊 Waterlevel Stations: ${wlCount[0].count} (Cleaned, 0 DWR)`);
  console.log(`  📊 Rainfall Stations:   ${rainCount[0].count}`);
  console.log(`  📊 Total Active in DB:  ${(wlCount[0].count as number) + (rainCount[0].count as number)}`);
  console.log(`  📊 Telemetry Cached:    ${teleCount[0].count}`);
  console.log("========================================================");

  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error during station import:", err);
  process.exit(1);
});
