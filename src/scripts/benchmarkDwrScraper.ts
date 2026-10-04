import { db } from "../db";
import { rainfallStations } from "../db/schema";
import { or, ilike } from "drizzle-orm";
import { dwrScraper, DwrScrapeResult } from "../services/dwrScraperService";

async function getDwrStationsFromDb(limit: number = 20) {
  const stations = await db
    .select({
      id: rainfallStations.id,
      oldcode: rainfallStations.oldcode,
      nameTh: rainfallStations.nameTh,
      basinId: rainfallStations.basinId,
    })
    .from(rainfallStations)
    .where(
      or(
        ilike(rainfallStations.agencyShortnameEn, "%DWR%"),
        ilike(rainfallStations.oldcode, "STN%")
      )
    )
    .limit(limit);

  return stations.filter((s) => s.oldcode && s.oldcode.trim() !== "");
}

async function runBenchmark() {
  console.log("===============================================================================");
  console.log("  🌧️ DWR RAINFALL SCRAPER BENCHMARK (TypeScript / Bun Engine)");
  console.log("===============================================================================\n");

  const stations = await getDwrStationsFromDb(20);
  if (stations.length === 0) {
    console.error("❌ No DWR stations found in database!");
    process.exit(1);
  }

  console.log(`Loaded ${stations.length} sample DWR stations from PostgreSQL:`);
  stations.forEach((s, idx) => {
    console.log(`  [${(idx + 1).toString().padStart(2, " ")}] ${s.oldcode} (${s.nameTh}) [Basin: ${s.basinId}]`);
  });
  console.log("\n" + "-".repeat(79) + "\n");

  // -------------------------------------------------------------------------
  // TEST 1: Single Station Benchmark (3 consecutive runs to measure cold/warm)
  // -------------------------------------------------------------------------
  const sampleStn = stations[0].oldcode!;
  console.log(`>>> BENCHMARK 1: Single Station Scrape (${sampleStn}) <<<`);

  const singleRuns: number[] = [];
  let sampleResult: DwrScrapeResult | undefined;

  for (let i = 1; i <= 3; i++) {
    const res = await dwrScraper.scrapeStationLatest(sampleStn, { hourlyOnly: true });
    singleRuns.push(res.durationMs);
    sampleResult = res;
    console.log(
      `  Run #${i}: ${res.durationMs.toFixed(1)}ms | Success: ${res.success} | Datetime: ${
        res.latestRecord?.datetime ?? "N/A"
      } | Rain: ${res.latestRecord?.rainfallMm ?? "N/A"} mm`
    );
  }

  const avgSingle = singleRuns.reduce((a, b) => a + b, 0) / singleRuns.length;
  console.log(`\n  👉 Average Latency (1 Station): ${avgSingle.toFixed(1)} ms (~${(avgSingle / 1000).toFixed(2)}s)\n`);
  console.log("-".repeat(79) + "\n");

  const codes20 = stations.map((s) => s.oldcode!);

  // -------------------------------------------------------------------------
  // TEST 2A: 20 Stations - Sequential (Concurrency = 1, polite delay = 50ms)
  // -------------------------------------------------------------------------
  console.log(">>> BENCHMARK 2A: 20 Stations (Sequential: Concurrency = 1, delay = 50ms) <<<");
  const tSeqStart = performance.now();
  const seqResult = await dwrScraper.scrapeStationsBatch(codes20, {
    concurrency: 1,
    delayMs: 50,
    onProgress: (done, total, r) => {
      process.stdout.write(
        `\r    Progress: ${done}/${total} (${((done / total) * 100).toFixed(0)}%) | Current: ${r.stationCode} (${r.durationMs.toFixed(0)}ms)   `
      );
    },
  });
  console.log("\n");
  console.log(`  ⏱️ Total Time (20 Stations Sequential): ${(seqResult.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  ⚡ Avg per station: ${seqResult.avgDurationPerStationMs.toFixed(1)}ms`);
  console.log(`  ✅ Success: ${seqResult.successful}/${seqResult.totalStations}`);
  console.log("\n" + "-".repeat(79) + "\n");

  // -------------------------------------------------------------------------
  // TEST 2B: 20 Stations - Concurrent (Concurrency = 4, delay = 50ms, Python-like)
  // -------------------------------------------------------------------------
  console.log(">>> BENCHMARK 2B: 20 Stations (Concurrent: 4 Workers, delay = 50ms) <<<");
  const con4Result = await dwrScraper.scrapeStationsBatch(codes20, {
    concurrency: 4,
    delayMs: 50,
    onProgress: (done, total, r) => {
      process.stdout.write(
        `\r    Progress: ${done}/${total} (${((done / total) * 100).toFixed(0)}%) | Current: ${r.stationCode} (${r.durationMs.toFixed(0)}ms)   `
      );
    },
  });
  console.log("\n");
  console.log(`  ⏱️ Total Time (20 Stations, 4 Workers): ${(con4Result.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  ⚡ Effective rate: ${(con4Result.totalDurationMs / 20).toFixed(1)}ms per station`);
  console.log(`  ✅ Success: ${con4Result.successful}/${con4Result.totalStations}`);
  console.log("\n" + "-".repeat(79) + "\n");

  // -------------------------------------------------------------------------
  // TEST 2C: 20 Stations - High Throughput (Concurrency = 8, delay = 0ms)
  // -------------------------------------------------------------------------
  console.log(">>> BENCHMARK 2C: 20 Stations (High-Throughput: 8 Workers, delay = 0ms) <<<");
  const con8Result = await dwrScraper.scrapeStationsBatch(codes20, {
    concurrency: 8,
    delayMs: 0,
    onProgress: (done, total, r) => {
      process.stdout.write(
        `\r    Progress: ${done}/${total} (${((done / total) * 100).toFixed(0)}%) | Current: ${r.stationCode} (${r.durationMs.toFixed(0)}ms)   `
      );
    },
  });
  console.log("\n");
  console.log(`  ⏱️ Total Time (20 Stations, 8 Workers): ${(con8Result.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  ⚡ Effective rate: ${(con8Result.totalDurationMs / 20).toFixed(1)}ms per station`);
  console.log(`  ✅ Success: ${con8Result.successful}/${con8Result.totalStations}`);
  console.log("\n" + "=".repeat(79) + "\n");

  // Sample Scraped Data Summary
  console.log("📊 SAMPLE SCRAPED DATA (First 5 Stations):");
  console.table(
    con4Result.results.slice(0, 5).map((r) => ({
      Station: r.stationCode,
      Success: r.success,
      Datetime: r.latestRecord?.datetime ?? "N/A",
      "Rain (mm)": r.latestRecord?.rainfallMm ?? "N/A",
      "Latency (ms)": Math.round(r.durationMs),
    }))
  );

  console.log("\n💡 SUMMARY & PROJECTION (1,150 total DWR stations):");
  console.log(`  - 1 Station Latency:           ~${avgSingle.toFixed(0)} ms (~${(avgSingle / 1000).toFixed(2)}s)`);
  console.log(`  - 20 Stations (Sequential):    ${(seqResult.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  - 20 Stations (4 Workers):     ${(con4Result.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  - 20 Stations (8 Workers):     ${(con8Result.totalDurationMs / 1000).toFixed(2)}s`);
  console.log(
    `  - Extrapolated for 1,150 Stations (8 Workers): ~${(
      (con8Result.totalDurationMs / 20) *
      1150 /
      1000
    ).toFixed(1)}s (~${(((con8Result.totalDurationMs / 20) * 1150) / 60000).toFixed(2)} minutes)`
  );
  console.log("===============================================================================\n");

  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
