import { DWR_SUPPORTED_PROVINCES, parseDwrProvinceTime } from "../services/dwrScraperService";
import { r2Storage } from "../services/r2StorageService";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const PROVINCE_DATA_URL = "http://ews1.dwr.go.th/ews/province-data";
const PROVINCE_DATA_URL_FALLBACK = "https://ews1.dwr.go.th/ews/province-data";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

interface StationScanResult {
  code: string;
  measuredAt: Date | null;
  ageDays: number | null;
  isInactive: boolean;
}

async function fetchProvinceRaw(province: string): Promise<string | null> {
  const urls = [
    `${PROVINCE_DATA_URL}?FilterProvince=${encodeURIComponent(province)}`,
    `${PROVINCE_DATA_URL_FALLBACK}?FilterProvince=${encodeURIComponent(province)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        return await res.text();
      }
    } catch {
      // Failover to next URL
    }
  }
  return null;
}

function parseStationsFromHtml(html: string, now: number): StationScanResult[] {
  const match = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!match) return [];

  const rows = [...match[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const stations: StationScanResult[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );

    if (cells.length < 15) continue;
    const rawCode = cells[1].trim();
    if (rawCode.startsWith("หมู่บ้าน")) continue;
    if (!rawCode.toUpperCase().startsWith("STN")) continue;

    const code = rawCode.replace(/\*/g, "").trim().toUpperCase();
    const timeStr = cells[14];
    const measuredAt = parseDwrProvinceTime(timeStr);

    let isInactive = false;
    let ageDays: number | null = null;

    if (!measuredAt) {
      isInactive = true;
    } else {
      const ageMs = now - measuredAt.getTime();
      ageDays = Number((ageMs / (24 * 60 * 60 * 1000)).toFixed(1));
      if (ageMs > FIVE_DAYS_MS) {
        isInactive = true;
      }
    }

    stations.push({
      code,
      measuredAt,
      ageDays,
      isInactive,
    });
  }

  return stations;
}

export async function scanInactiveDwrStations(): Promise<string[]> {
  const now = Date.now();
  const tStart = performance.now();
  console.log("===============================================================================");
  console.log("  🔍 SCANNING INACTIVE DWR STATIONS (> 5 DAYS WITHOUT UPDATE)");
  console.log("===============================================================================\n");
  console.log(`Targeting ${DWR_SUPPORTED_PROVINCES.length} provinces from DWR province-data...`);

  const queue = [...DWR_SUPPORTED_PROVINCES];
  const allStations = new Map<string, StationScanResult>();
  const CONCURRENCY = 5;
  let completedProvinces = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const prov = queue.shift();
      if (!prov) break;

      const html = await fetchProvinceRaw(prov);
      if (html) {
        const stations = parseStationsFromHtml(html, now);
        for (const st of stations) {
          if (!allStations.has(st.code)) {
            allStations.set(st.code, st);
          }
        }
      } else {
        console.warn(`  ⚠️ Failed to fetch province: ${prov}`);
      }

      completedProvinces++;
      process.stdout.write(
        `\r  Progress: ${completedProvinces}/${DWR_SUPPORTED_PROVINCES.length} provinces scanned (${allStations.size} stations found)...`
      );

      // Polite delay between batch requests
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log("\n");

  const inactiveStationCodes: string[] = [];
  const activeStationCodes: string[] = [];

  for (const [code, st] of allStations) {
    if (st.isInactive) {
      inactiveStationCodes.push(code);
    } else {
      activeStationCodes.push(code);
    }
  }

  inactiveStationCodes.sort();
  activeStationCodes.sort();

  const durationSec = ((performance.now() - tStart) / 1000).toFixed(1);
  console.log("-------------------------------------------------------------------------------");
  console.log(`⏱️ Scan completed in ${durationSec}s`);
  console.log(`🏢 Total Unique Stations Scanned: ${allStations.size}`);
  console.log(`✅ Active Stations (updated within 5 days): ${activeStationCodes.length}`);
  console.log(`❌ Inactive Stations (> 5 days without update): ${inactiveStationCodes.length}`);
  console.log("-------------------------------------------------------------------------------\n");

  if (inactiveStationCodes.length > 0) {
    console.log(`Sample Inactive Stations (First 15):`);
    console.log(inactiveStationCodes.slice(0, 15));
  }

  // Upload to Cloudflare R2
  const r2Key = "dwr/inactive_stations.json";
  console.log(`\n☁️ Uploading inactive stations list to Cloudflare R2: ${r2Key}...`);

  const putRes = await r2Storage.putJson(
    r2Key,
    inactiveStationCodes,
    "public, max-age=3600, s-maxage=86400"
  );

  console.log(`✨ Successfully uploaded to R2!`);
  console.log(`🔗 Public URL: ${putRes.url}\n`);

  return inactiveStationCodes;
}

if (import.meta.main) {
  scanInactiveDwrStations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Fatal error scanning inactive stations:", err);
      process.exit(1);
    });
}
