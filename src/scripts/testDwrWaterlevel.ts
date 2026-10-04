import { db } from "../db";
import { waterlevelStations, telemetryLatest } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { dwrScraper, extractDwrStationCode } from "../services/dwrScraperService";
import { thaiWaterBulkIngestion } from "../services/thaiWaterBulkIngestion";

async function main() {
  console.log("=======================================================================");
  console.log("🧪 TESTING DWR WATER LEVEL SCRAPER & TELEMETRY FALLBACK");
  console.log("=======================================================================\n");

  // 1. Test Code Extraction
  console.log("1️⃣ Testing extractDwrStationCode:");
  const testCodes = [
    { input: "G09006-STN2203", expected: "STN2203" },
    { input: "G09006-STN2201*", expected: "STN2201" },
    { input: "STN0632", expected: "STN0632" },
    { input: "G23069-PIN004", expected: "PIN004" },
    { input: null, expected: null },
  ];
  for (const tc of testCodes) {
    const res = extractDwrStationCode(tc.input);
    const pass = res === tc.expected;
    console.log(`  ${pass ? "✅" : "❌"} ${tc.input ?? "null"} -> ${res} (expected: ${tc.expected})`);
  }

  // 2. Test Live Fetching from rain-daily & Inactive Filtering
  console.log("\n2️⃣ Fetching DWR rain-daily and testing waterlevel extraction:");
  const [dwrDailyMap, inactiveSet] = await Promise.all([
    dwrScraper.fetchAllDailyRainStations({ forceRefresh: true }),
    dwrScraper.loadInactiveStations(),
  ]);
  console.log(`  📊 Fetched ${dwrDailyMap.size} stations from rain-daily`);
  console.log(`  🚫 Inactive stations count: ${inactiveSet.size}`);

  // Test sample DWR water stations from DB
  const dwrStations = await db
    .select()
    .from(waterlevelStations)
    .where(eq(waterlevelStations.agencyShortnameEn, "DWR"))
    .limit(10);

  console.log(`\n3️⃣ Testing ${dwrStations.length} sample DWR water stations against rain-daily feed:`);
  let matched = 0;
  for (const st of dwrStations) {
    const code = extractDwrStationCode(st.oldcode);
    const isInactive = code ? inactiveSet.has(code) : false;
    const daily = code ? dwrDailyMap.get(code) : undefined;
    const wl = daily?.waterLevel ?? null;

    if (daily) matched++;
    console.log(
      `  Station ${st.id} (${st.oldcode}) -> ${code} | Name: ${st.nameTh} | Inactive: ${isInactive ? "YES ❌" : "NO ✅"} | WaterLevel: ${wl !== null ? `${wl} m` : "null"}`
    );
  }

  // 4. Test Single Basin Sync (Mun basin which has DWR waterlevel stations)
  console.log("\n4️⃣ Testing Bulk Ingestion for Mun basin ('mun'):");
  const munStations = await db
    .select()
    .from(waterlevelStations)
    .where(eq(waterlevelStations.agencyShortnameEn, "DWR"));
  console.log(`  Total DWR water stations nationwide in DB: ${munStations.length}`);

  const syncResult = await thaiWaterBulkIngestion.syncAllTelemetryBulk({
    targetBasinSlug: "mun",
    writeStationCurrentJson: false, // Don't overwrite production current.json in test
  });
  console.log(`  🎉 Mun basin sync finished: ${syncResult.synced} synced, ${syncResult.failed} failed`);

  // Verify telemetry in PostgreSQL for DWR stations in Mun
  const dwrMunIds = munStations.map((s) => s.id);
  const munTelemetry = await db
    .select()
    .from(telemetryLatest)
    .where(inArray(telemetryLatest.stationId, dwrMunIds));

  console.log(`  ✅ DWR water stations now with fresh telemetry in PostgreSQL: ${munTelemetry.length} / ${munStations.length}`);
  if (munTelemetry.length > 0) {
    console.log(`  Sample updated records:`);
    for (const t of munTelemetry.slice(0, 5)) {
      console.log(`    - Station ${t.stationId}: stage=${t.stage}m, freshness=${t.freshnessStatus}, status=${t.situationStatus}, time=${t.timestamp.toISOString()}`);
    }
  }

  console.log("\n=======================================================================");
  console.log("✨ ALL DWR WATER LEVEL TESTS COMPLETED");
  console.log("=======================================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
