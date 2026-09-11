import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { eq, or, sql } from "drizzle-orm";
import { env } from "../config/env";
import { hasR2Credentials, r2Client } from "../config/r2";
import { db, queryClient } from "../db";
import {
  basins,
  datasetRegistry,
  rainfallStations,
  stationRelations,
  telemetryLatest,
  waterlevelStations,
} from "../db/schema";
import { r2Publisher } from "../services/r2PublisherService";

async function purgeR2Prefix(prefix: string): Promise<number> {
  if (!hasR2Credentials() || !r2Client) {
    console.log(`[R2] No credentials configured. Skipping R2 purge for prefix: ${prefix}`);
    return 0;
  }

  let totalDeleted = 0;
  let continuationToken: string | undefined = undefined;

  do {
    const listRes: any = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (listRes.Contents || []).map((c: any) => ({ Key: c.Key! })).filter((k: any) => Boolean(k.Key));

    if (keys.length > 0) {
      // Delete in batches of up to 1000
      await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET_NAME,
          Delete: {
            Objects: keys,
            Quiet: true,
          },
        })
      );
      totalDeleted += keys.length;
      console.log(`  🗑️ Deleted batch of ${keys.length} objects from R2 (${prefix})`);
    }

    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
  } while (continuationToken);

  return totalDeleted;
}

function purgeLocalFallback(relativePath: string) {
  const localDir = join(process.cwd(), ".r2-local", relativePath);
  if (existsSync(localDir)) {
    rmSync(localDir, { recursive: true, force: true });
    console.log(`  🗑️ Removed local fallback folder: ${localDir}`);
  }
}

async function main() {
  console.log("===============================================================");
  console.log("🌊 PURGING CHAO PHRAYA BASIN FROM DATABASE & R2 STORAGE");
  console.log("===============================================================\n");

  const targetBasinId = "chao-phraya";

  // 1. Get list of all Chao Phraya stations before deletion
  const chaoWL = await db
    .select({ id: waterlevelStations.id })
    .from(waterlevelStations)
    .where(eq(waterlevelStations.basinId, targetBasinId));
  const chaoRF = await db
    .select({ id: rainfallStations.id })
    .from(rainfallStations)
    .where(eq(rainfallStations.basinId, targetBasinId));

  const allStationIds = Array.from(new Set([...chaoWL.map((s) => s.id), ...chaoRF.map((s) => s.id)]));
  console.log(`📊 Found in DB: ${chaoWL.length} WL stations, ${chaoRF.length} RF stations for basin '${targetBasinId}'`);

  // 2. Delete relations
  console.log("\n1️⃣ Deleting station relations...");
  if (allStationIds.length > 0) {
    const relRes = await db.execute(sql`
      DELETE FROM station_relations
      WHERE station_id IN (
        SELECT id FROM waterlevel_stations WHERE basin_id = ${targetBasinId}
        UNION
        SELECT id FROM rainfall_stations WHERE basin_id = ${targetBasinId}
      )
      OR target_station_id IN (
        SELECT id FROM waterlevel_stations WHERE basin_id = ${targetBasinId}
        UNION
        SELECT id FROM rainfall_stations WHERE basin_id = ${targetBasinId}
      );
    `);
    console.log(`  ✅ Deleted station relations referencing Chao Phraya stations`);
  }

  // 3. Delete telemetry latest
  console.log("\n2️⃣ Deleting telemetry records...");
  await db.execute(sql`
    DELETE FROM telemetry_latest
    WHERE basin_id = ${targetBasinId}
    OR station_id IN (
      SELECT id FROM waterlevel_stations WHERE basin_id = ${targetBasinId}
      UNION
      SELECT id FROM rainfall_stations WHERE basin_id = ${targetBasinId}
    );
  `);
  console.log(`  ✅ Deleted telemetry_latest records for Chao Phraya`);

  // 4. Delete dataset registry
  console.log("\n3️⃣ Deleting dataset registry entries...");
  await db.execute(sql`
    DELETE FROM dataset_registry
    WHERE basin_id = ${targetBasinId}
    OR r2_path LIKE '%chao-phraya%';
  `);
  console.log(`  ✅ Deleted dataset_registry records`);

  // 5. Delete waterlevel stations
  console.log("\n4️⃣ Deleting waterlevel stations...");
  const deletedWL = await db.delete(waterlevelStations).where(eq(waterlevelStations.basinId, targetBasinId));
  console.log(`  ✅ Deleted waterlevel_stations for ${targetBasinId}`);

  // 6. Delete rainfall stations
  console.log("\n5️⃣ Deleting rainfall stations...");
  const deletedRF = await db.delete(rainfallStations).where(eq(rainfallStations.basinId, targetBasinId));
  console.log(`  ✅ Deleted rainfall_stations for ${targetBasinId}`);

  // 7. Delete basin record
  console.log("\n6️⃣ Deleting basin record...");
  await db.delete(basins).where(or(eq(basins.id, targetBasinId), eq(basins.slug, targetBasinId)));
  console.log(`  ✅ Deleted basin '${targetBasinId}' from basins table`);

  // 8. Purge Cloudflare R2 objects
  console.log("\n7️⃣ Purging R2 Storage Objects...");
  const r2Prefixes = [
    "basin/chao-phraya",
    "waterlevel_station/chao-phraya",
    "rainfall_station/chao-phraya",
    "spatial/chao-phraya",
  ];

  let totalR2Deleted = 0;
  for (const prefix of r2Prefixes) {
    const deletedCount = await purgeR2Prefix(prefix);
    console.log(`  ✅ Purged ${deletedCount} objects under prefix '${prefix}'`);
    totalR2Deleted += deletedCount;
  }
  console.log(`  🎉 Total R2 objects deleted: ${totalR2Deleted}`);

  // 9. Purge local fallback files
  console.log("\n8️⃣ Purging local fallback (.r2-local) cache...");
  purgeLocalFallback("basin/chao-phraya");
  purgeLocalFallback("waterlevel_station/chao-phraya");
  purgeLocalFallback("rainfall_station/chao-phraya");
  console.log(`  ✅ Local fallback cleaned`);

  // 10. Re-publish root /basins.json on R2
  console.log("\n9️⃣ Re-publishing root /basins.json on R2...");
  try {
    const res = await r2Publisher.publishBasinsList();
    console.log(`  ✅ Successfully updated root /basins.json: ${res.url}`);
  } catch (err: any) {
    console.warn(`  ⚠️ Failed to re-publish root basins list:`, err.message);
  }

  console.log("\n===============================================================");
  console.log("🎉 CHAO PHRAYA BASIN COMPLETELY PURGED SUCCESSFULLY!");
  console.log("===============================================================\n");

  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal error during Chao Phraya purge:", err);
  process.exit(1);
});
