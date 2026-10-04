/**
 * DWR (Department of Water Resources / กรมทรัพยากรน้ำ) Rainfall Scraper Service
 * Ported & optimized from flood-analysis-model/scrape_dwr_rain.py
 *
 * Targets direct HTTP endpoint: http://ews1.dwr.go.th/ews/show-rain
 * (ews1 HTTP avoids TLS handshake overhead, 10x faster than HTTPS in Thailand)
 */

export interface DwrRainfallRecord {
  stationCode: string;
  datetime: string; // ISO / Bangkok: "YYYY-MM-DD HH:mm:00"
  rainfallMm: number;
}

export interface DwrDailyRainStation {
  stationCode: string; // e.g. "STN0632"
  name: string;        // e.g. "บ้านทุ่งมะส้าน"
  tambon: string;
  amphoe: string;
  province: string;
  rain15m: number;     // ฝน 15 นาที
  rain12h: number;     // ฝน 12 ชม
  rainDaily: number;   // ฝนรายวัน (07:00)
  temperature?: number | null;
  waterLevel?: number | null;
  humidity?: number | null;
  fetchedAt: Date;
}

export interface DwrScrapeResult {
  success: boolean;
  stationCode: string;
  latestRecord?: DwrRainfallRecord;
  recordsCount?: number;
  durationMs: number;
  error?: string;
}

export interface DwrBatchScrapeResult {
  totalStations: number;
  successful: number;
  failed: number;
  totalDurationMs: number;
  avgDurationPerStationMs: number;
  results: DwrScrapeResult[];
}

export interface DwrScrapeOptions {
  timeoutMs?: number;
  hourlyOnly?: boolean;
  filterDate?: string; // YYYY-MM-DD (defaults to DWR's latest / today)
}

const BASE_URL = "http://ews1.dwr.go.th/ews/show-rain";
const DAILY_RAIN_URL = "http://ews1.dwr.go.th/ews/rain-daily";
const DAILY_RAIN_URL_FALLBACK = "https://ews1.dwr.go.th/ews/rain-daily";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};


export class DwrScraperService {
  /**
   * Scrapes the latest rainfall record for a single DWR station.
   */
  async scrapeStationLatest(
    stationCode: string,
    options: DwrScrapeOptions = {}
  ): Promise<DwrScrapeResult> {
    const { timeoutMs = 8000, hourlyOnly = true, filterDate } = options;
    const startTime = performance.now();

    const cleanCode = stationCode.trim();
    if (!cleanCode) {
      return {
        success: false,
        stationCode,
        durationMs: 0,
        error: "Empty station code",
      };
    }

    const params: Record<string, string> = {
      FilterSTN: cleanCode,
      FilterType: "1D",
    };
    if (filterDate) {
      params.FilterDate = filterDate;
    }

    const query = new URLSearchParams(params).toString();
    const url = `${BASE_URL}?${query}`;

    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return {
          success: false,
          stationCode: cleanCode,
          durationMs: performance.now() - startTime,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      const html = await response.text();

      // Extract target date from the form or fallback to today
      const dateMatch = html.match(/name=["']FilterDate["'][^>]*value=["']([^"']*)["']/i);
      const targetDate = dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0];

      // Extract categories (timestamps) & rain data array from Highcharts script
      const catMatch = html.match(/categories:\s*\[(.*?)\]/s);
      const rainMatch = html.match(
        /name:\s*['\"][^'\"]*ปริมาณน้ำฝน[^'\"]*['\"].*?data:\s*\[(.*?)\]/s
      );

      if (!catMatch || !rainMatch) {
        return {
          success: false,
          stationCode: cleanCode,
          durationMs: performance.now() - startTime,
          error: "No rainfall data chart found in response",
        };
      }

      const rawCats = catMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      const rawRains = rainMatch[1]
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);

      if (rawCats.length === 0 || rawRains.length === 0) {
        return {
          success: false,
          stationCode: cleanCode,
          durationMs: performance.now() - startTime,
          error: "Empty rainfall series",
        };
      }

      // Walk backward to find the latest valid observation
      // (as specified in user prompt: "scrapper แค่ของชั่วโมงล่าสุดก็พอแล้ว")
      let latestRecord: DwrRainfallRecord | undefined = undefined;
      let validCount = 0;

      for (let i = rawCats.length - 1; i >= 0; i--) {
        const rawTime = rawCats[i].replace("น.", "").trim();
        const rawValStr = rawRains[i].toLowerCase();

        // Skip invalid / null / placeholder values
        if (
          rawValStr === "" ||
          rawValStr === "null" ||
          rawValStr === "none" ||
          rawValStr === "nan" ||
          rawValStr === "-" ||
          rawValStr === "--" ||
          rawValStr === "undefined"
        ) {
          continue;
        }

        const val = parseFloat(rawValStr);
        if (isNaN(val) || val < 0.0 || val > 500.0) {
          continue;
        }

        validCount++;

        // Format time to HH:mm:00
        const timeParts = rawTime.split(":");
        if (timeParts.length < 2) continue;
        const hh = timeParts[0].padStart(2, "0");
        const mm = timeParts[1].padStart(2, "0");

        if (hourlyOnly && mm !== "00") {
          continue;
        }

        if (!latestRecord) {
          latestRecord = {
            stationCode: cleanCode,
            datetime: `${targetDate} ${hh}:${mm}:00`,
            rainfallMm: val,
          };
          // Once we found the latest target hour record, we can break or continue counting
          break;
        }
      }

      // If hourlyOnly was set but no exact :00 record was found, fallback to the latest valid record
      if (!latestRecord && validCount > 0 && hourlyOnly) {
        for (let i = rawCats.length - 1; i >= 0; i--) {
          const rawValStr = rawRains[i].toLowerCase();
          if (
            rawValStr === "" ||
            rawValStr === "null" ||
            rawValStr === "none" ||
            rawValStr === "nan" ||
            rawValStr === "-" ||
            rawValStr === "--"
          ) {
            continue;
          }
          const val = parseFloat(rawValStr);
          if (isNaN(val) || val < 0.0 || val > 500.0) continue;

          const timeParts = rawCats[i].replace("น.", "").trim().split(":");
          const hh = (timeParts[0] || "00").padStart(2, "0");
          const mm = (timeParts[1] || "00").padStart(2, "0");

          latestRecord = {
            stationCode: cleanCode,
            datetime: `${targetDate} ${hh}:${mm}:00`,
            rainfallMm: val,
          };
          break;
        }
      }

      const durationMs = performance.now() - startTime;

      if (!latestRecord) {
        return {
          success: false,
          stationCode: cleanCode,
          recordsCount: 0,
          durationMs,
          error: "No valid numeric rainfall records found",
        };
      }

      return {
        success: true,
        stationCode: cleanCode,
        latestRecord,
        recordsCount: validCount,
        durationMs,
      };
    } catch (err: any) {
      return {
        success: false,
        stationCode: cleanCode,
        durationMs: performance.now() - startTime,
        error: err.name === "TimeoutError" ? "Request timeout" : err.message || String(err),
      };
    }
  }

  /**
   * Scrapes multiple DWR stations with controlled concurrency and optional polite delay.
   */
  async scrapeStationsBatch(
    stationCodes: string[],
    options: {
      concurrency?: number;
      delayMs?: number;
      hourlyOnly?: boolean;
      timeoutMs?: number;
      onProgress?: (done: number, total: number, result: DwrScrapeResult) => void;
    } = {}
  ): Promise<DwrBatchScrapeResult> {
    const { concurrency = 4, delayMs = 50, hourlyOnly = true, timeoutMs = 8000, onProgress } = options;

    const tBatchStart = performance.now();
    const results: DwrScrapeResult[] = [];
    let completed = 0;

    // Worker pool
    const queue = [...stationCodes];
    const worker = async () => {
      while (queue.length > 0) {
        const code = queue.shift();
        if (!code) break;

        const res = await this.scrapeStationLatest(code, { hourlyOnly, timeoutMs });
        results.push(res);
        completed++;

        if (onProgress) {
          onProgress(completed, stationCodes.length, res);
        }

        if (delayMs > 0 && queue.length > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, stationCodes.length) }, () =>
      worker()
    );
    await Promise.all(workers);

    const totalDurationMs = performance.now() - tBatchStart;
    const successful = results.filter((r) => r.success).length;

    return {
      totalStations: stationCodes.length,
      successful,
      failed: stationCodes.length - successful,
      totalDurationMs,
      avgDurationPerStationMs: stationCodes.length > 0 ? totalDurationMs / stationCodes.length : 0,
      results,
    };
  }

  private dailyCache: Map<string, DwrDailyRainStation> | null = null;
  private dailyCacheExpiry: number = 0;
  private isFetchingDaily: Promise<Map<string, DwrDailyRainStation>> | null = null;
  private lastFetchFailedAt: number = 0;
  private readonly FAILURE_COOLDOWN_MS = 60 * 1000; // 1 minute circuit-breaker cooldown

  /**
   * Fetches all daily rain stations from http://ews1.dwr.go.th/ews/rain-daily in ONE single request.
   * Returns a Map keyed by station code (uppercase).
   * Automatically cached in memory for 2 minutes to avoid re-fetching across multiple basins.
   * Includes circuit breaker: if DWR is unreachable, it will back off for 1 minute instead of freezing every basin.
   */
  async fetchAllDailyRainStations(options: {
    forceRefresh?: boolean;
    timeoutMs?: number;
  } = {}): Promise<Map<string, DwrDailyRainStation>> {
    const { forceRefresh = false, timeoutMs = 10000 } = options;
    const now = Date.now();

    // 1. Check active cache
    if (!forceRefresh && this.dailyCache && now < this.dailyCacheExpiry) {
      return this.dailyCache;
    }

    // 2. Circuit Breaker: If recently failed, don't hammer the down server, return stale cache or empty map
    if (!forceRefresh && now - this.lastFetchFailedAt < this.FAILURE_COOLDOWN_MS) {
      return this.dailyCache || new Map<string, DwrDailyRainStation>();
    }

    // 3. Deduplicate in-flight requests
    if (this.isFetchingDaily) {
      return this.isFetchingDaily;
    }

    this.isFetchingDaily = (async () => {
      try {
        let html: string | null = null;
        const urls = [DAILY_RAIN_URL, DAILY_RAIN_URL_FALLBACK];

        for (const url of urls) {
          try {
            const res = await fetch(url, {
              headers: HEADERS,
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (res.ok) {
              html = await res.text();
              break;
            }
          } catch (err: any) {
            // Failover to next URL
          }
        }

        if (!html) {
          this.lastFetchFailedAt = Date.now();
          console.warn("⚠️ [DwrScraper] Failed to fetch rain-daily from both HTTP and HTTPS endpoints");
          return this.dailyCache || new Map<string, DwrDailyRainStation>();
        }

        // Parse tableData-rain_12 (or tableData-rain_24)
        const match = html.match(/<table[^>]*tableData-rain_12[^>]*>([\s\S]*?)<\/table>/i);
        if (!match) {
          this.lastFetchFailedAt = Date.now();
          console.warn("⚠️ [DwrScraper] Could not find tableData-rain_12 in rain-daily HTML response");
          return this.dailyCache || new Map<string, DwrDailyRainStation>();
        }

        const rows = [...match[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        const resultMap = new Map<string, DwrDailyRainStation>();
        const fetchedAt = new Date();

        for (let i = 1; i < rows.length; i++) {
          const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
            m[1].replace(/<[^>]+>/g, "").trim()
          );

          if (cells.length >= 11) {
            const rawCode = cells[1].replace(/\*/g, "").trim().toUpperCase();
            if (!rawCode.startsWith("STN")) continue;

            const rain15m = parseFloat(cells[8]);
            const rain12h = parseFloat(cells[9]);
            const rainDaily = parseFloat(cells[10]);
            const temp = parseFloat(cells[11]);
            const wl = parseFloat(cells[12]);
            const hum = parseFloat(cells[13]);

            // Data sanitization with physical upper & lower bounds:
            const safeRain15m = isNaN(rain15m) || rain15m < 0 || rain15m > 300 ? 0 : rain15m;
            const safeRain12h = isNaN(rain12h) || rain12h < 0 || rain12h > 1000 ? 0 : rain12h;
            const safeRainDaily = isNaN(rainDaily) || rainDaily < 0 || rainDaily > 1500 ? 0 : rainDaily;
            const safeTemp = isNaN(temp) || temp < -10 || temp > 65 ? null : temp;
            const safeWl = isNaN(wl) ? null : wl;
            const safeHum = isNaN(hum) || hum < 0 || hum > 100 ? null : hum;

            resultMap.set(rawCode, {
              stationCode: rawCode,
              name: cells[2] || "",
              tambon: cells[3] || "",
              amphoe: cells[4] || "",
              province: cells[5] || "",
              rain15m: safeRain15m,
              rain12h: safeRain12h,
              rainDaily: safeRainDaily,
              temperature: safeTemp,
              waterLevel: safeWl,
              humidity: safeHum,
              fetchedAt,
            });
          }
        }

        if (resultMap.size > 0) {
          this.dailyCache = resultMap;
          this.dailyCacheExpiry = Date.now() + 2 * 60 * 1000; // 2 minutes TTL
          this.lastFetchFailedAt = 0; // Reset failure timestamp
          console.log(`🌧️ [DwrScraper] Fetched & cached ${resultMap.size} DWR stations from rain-daily`);
        } else {
          console.warn("⚠️ [DwrScraper] Parsed 0 stations from rain-daily, preserving existing cache if available");
        }

        return resultMap.size > 0 ? resultMap : (this.dailyCache || new Map<string, DwrDailyRainStation>());
      } catch (err: any) {
        this.lastFetchFailedAt = Date.now();
        console.warn("⚠️ [DwrScraper] Unexpected error fetching rain-daily stations:", err?.message || err);
        return this.dailyCache || new Map<string, DwrDailyRainStation>();
      } finally {
        this.isFetchingDaily = null;
      }
    })();

    return this.isFetchingDaily;
  }

  /**
   * Quick lookup of a single station from the rain-daily feed.
   */
  async getDailyStation(stationCode: string): Promise<DwrDailyRainStation | null> {
    try {
      const map = await this.fetchAllDailyRainStations();
      const clean = stationCode.replace(/\*/g, "").trim().toUpperCase();
      return map.get(clean) || null;
    } catch {
      return null;
    }
  }
}


export const dwrScraper = new DwrScraperService();
