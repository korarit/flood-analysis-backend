import { eq, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { basins, rainfallStations, telemetryLatest, waterlevelStations } from "../db/schema";
import {
  FreshnessStatus,
  RainIntensity,
  SituationStatus,
  StationCurrentDataset,
  TrendDirection,
} from "../types";
import { r2Publisher } from "./r2PublisherService";
import { r2Storage } from "./r2StorageService";

export interface ThaiWaterBulkRainfallItem {
  id?: string;
  type?: string;
  measureAt?: string;
  measureValue?: number | null;
  rainfallDatetime?: string;
  rainfall24h?: number | null;
  rainfallToday?: number | null;
  percentageDiff?: number | null;
  station?: {
    id: string | number;
    type?: string;
    stationType?: string;
    stationCode?: string;
    oldStationCode?: string;
    station?: string;
    latitude?: string | number;
    longitude?: string | number;
    sponsorBy?: string | null;
  };
  geoCode?: any;
  agency?: {
    id?: string | number;
    type?: string;
    agency?: string;
    agencyShort?: string;
  };
  basin?: {
    id?: string | number;
    type?: string;
    basin?: string;
    basinCode?: string;
  };
}

export interface ThaiWaterBulkWaterlevelItem {
  id?: string;
  type?: string;
  waterlevelDatetime?: string;
  measureAt?: string;
  waterlevelMsl?: number | null;
  waterlevelMslPrevious?: number | null;
  measureValue?: number | null;
  storagePercent?: number | null;
  diffWlBank?: number | null;
  diffWlBankText?: string | null;
  minBank?: number | null;
  riverName?: string | null;
  percentageDiff?: number | null;
  waterlevelDischarge?: number | null;
  station?: {
    id: string | number;
    type?: string;
    stationCode?: string;
    oldStationCode?: string;
    station?: string;
    latitude?: string | number;
    longitude?: string | number;
    groundLevel?: number | null;
    qmax?: number | null;
    sponsorBy?: string | null;
  };
  agency?: {
    id?: string | number;
    agency?: string;
    agencyShort?: string;
    agencyCode?: string;
  };
  basin?: {
    id?: string | number;
    basin?: string;
    basinCode?: string;
  };
}

export interface BulkIngestionResult {
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  durationMs: number;
  endpoints: {
    rainfallCount: number;
    waterlevelCount: number;
    dischargeCount: number;
    canalCount: number;
  };
  errors: any[];
}

export interface BulkIngestionOptions {
  targetBasinSlug?: string;
  writeStationCurrentJson?: boolean;
}

export class ThaiWaterBulkIngestionService {
  private baseUrl: string;
  private apiKey: string;
  private origin: string;
  private referer: string;

  constructor() {
    this.baseUrl = env.THAIWATER_API_BASE_URL.replace(/\/$/, "");
    this.apiKey = env.THAIWATER_API_KEY;
    this.origin = env.THAIWATER_ORIGIN;
    this.referer = env.THAIWATER_REFERER;
  }

  private getRequestHeaders(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      origin: this.origin,
      referer: this.referer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
    };
  }

  /**
   * Fetch with timeout and exponential backoff retry
   */
  private async fetchWithRetry<T>(
    endpointPath: string,
    label: string,
    maxRetries: number = 3,
    timeoutMs: number = 15000
  ): Promise<T[] | null> {
    const url = `${this.baseUrl}${endpointPath}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          headers: this.getRequestHeaders(),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as { data?: T[] };
        return json.data || [];
      } catch (err: any) {
        clearTimeout(timer);
        const isLastAttempt = attempt === maxRetries;
        console.warn(
          `⚠️ [BulkIngestion] ${label} attempt ${attempt}/${maxRetries} failed: ${err.message}${
            isLastAttempt ? " (giving up)" : " (retrying...)"
          }`
        );
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 500));
        }
      }
    }

    return null;
  }

  public calculateRainIntensity(rain24h: number | null): RainIntensity {
    if (rain24h === null || rain24h < 10) return "light";
    if (rain24h <= 35) return "moderate";
    if (rain24h <= 90) return "heavy";
    return "very_heavy";
  }

  public calculateFreshness(timestamp: Date): FreshnessStatus {
    const diffMs = Date.now() - timestamp.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 1.5) return "fresh";
    if (diffHours <= 3.5) return "delayed";
    return "missing";
  }

  public calculateTrend(currentWl: number | null, prevWl: number | null): TrendDirection {
    if (currentWl === null || prevWl === null || typeof currentWl !== "number" || typeof prevWl !== "number") {
      return "steady";
    }
    const diff = currentWl - prevWl;
    if (diff > 0.05) return "rising";
    if (diff < -0.05) return "falling";
    return "steady";
  }

  public evaluateSituationStatus(opts: {
    isWaterlevel: boolean;
    diffWlBank?: number | null;
    diffWlBankText?: string | null;
    storagePercent?: number | null;
    rain24h?: number | null;
    warningRain24h?: number;
    criticalRain24h?: number;
  }): SituationStatus {
    if (opts.isWaterlevel) {
      // 1. Critical Overflow check
      const isBankOverflow =
        opts.diffWlBankText?.includes("ล้นตลิ่ง") ||
        (opts.diffWlBank !== null && opts.diffWlBank !== undefined && opts.diffWlBank <= 0) ||
        (opts.storagePercent !== null && opts.storagePercent !== undefined && opts.storagePercent >= 100);
      if (isBankOverflow) return "critical";

      // 2. Prioritize storagePercent (actual river channel capacity %)
      // A station with low capacity (e.g. 15% - 20%) in a shallow creek is NOT high water
      if (opts.storagePercent !== null && opts.storagePercent !== undefined) {
        if (opts.storagePercent >= 85) return "warning";
        if (opts.storagePercent >= 70) return "watch";
        return "normal";
      }

      // 3. Fallback to diffWlBank ONLY when storagePercent is unavailable
      if (opts.diffWlBank !== null && opts.diffWlBank !== undefined) {
        if (opts.diffWlBank <= 0.5) return "warning";
        if (opts.diffWlBank <= 1.0) return "watch";
        return "normal";
      }
      return "normal";
    } else {
      const rain = opts.rain24h || 0;
      const crit = opts.criticalRain24h || 90.0;
      const warn = opts.warningRain24h || 35.0;
      if (rain >= crit) return "critical";
      if (rain >= warn) return "warning";
      if (rain >= warn * 0.6) return "watch";
      return "normal";
    }
    return "normal";
  }

  /**
   * Main Bulk Telemetry Ingestion Pipeline
   */
  async syncAllTelemetryBulk(options: BulkIngestionOptions = {}): Promise<BulkIngestionResult> {
    const t0 = Date.now();
    const { targetBasinSlug, writeStationCurrentJson = true } = options;

    console.log("⚡ [BulkIngestion] Starting parallel fetch from 4 ThaiWater v2 endpoints...");

    // 1. Concurrent fetching of all 4 bulk endpoints with graceful degradation
    const [rainPayload, wlPayload, dischargePayload, canalPayload] = await Promise.all([
      this.fetchWithRetry<ThaiWaterBulkRainfallItem>(
        "/v2/rainfall/rainfall_c1440/list?pagination[page]=1&pagination[pageSize]=5000",
        "Rainfall c1440"
      ),
      this.fetchWithRetry<ThaiWaterBulkWaterlevelItem>(
        "/v2/waterlevel/list?pagination[page]=1&pagination[pageSize]=2000",
        "Waterlevel List"
      ),
      this.fetchWithRetry<ThaiWaterBulkWaterlevelItem>(
        "/v2/waterlevel-discharge/list?pagination[page]=1&pagination[pageSize]=1000",
        "Discharge List"
      ),
      this.fetchWithRetry<any>(
        "/v2/waterlevel/canal/list?pagination[page]=1&pagination[pageSize]=1000",
        "Canal List"
      ),
    ]);

    const rainItems = rainPayload || [];
    const wlItems = wlPayload || [];
    const dischargeItems = dischargePayload || [];
    const canalItems = canalPayload || [];

    console.log(
      `📥 [BulkIngestion] Payloads received: ${rainItems.length} rain, ${wlItems.length} waterlevel, ${dischargeItems.length} discharge, ${canalItems.length} canal in ${Date.now() - t0}ms`
    );

    // 2. In-Memory Indexing
    const rainById = new Map<string, ThaiWaterBulkRainfallItem>();
    const rainByCode = new Map<string, ThaiWaterBulkRainfallItem>();

    for (const item of rainItems) {
      const st = item.station;
      if (st?.id) rainById.set(String(st.id), item);
      if (st?.stationCode) rainByCode.set(String(st.stationCode).toLowerCase(), item);
      if (st?.oldStationCode) rainByCode.set(String(st.oldStationCode).toLowerCase(), item);
    }

    // In-memory merge for waterlevel + discharge + canal
    const wlById = new Map<string, ThaiWaterBulkWaterlevelItem>();
    const wlByCode = new Map<string, ThaiWaterBulkWaterlevelItem>();

    // 2.1 Base waterlevel
    for (const item of wlItems) {
      const st = item.station;
      if (st?.id) wlById.set(String(st.id), item);
      if (st?.stationCode) wlByCode.set(String(st.stationCode).toLowerCase(), item);
      if (st?.oldStationCode) wlByCode.set(String(st.oldStationCode).toLowerCase(), item);
    }

    // 2.2 Merge discharge data
    for (const item of dischargeItems) {
      const st = item.station;
      const stId = st?.id ? String(st.id) : null;
      const stCode = st?.stationCode ? String(st.stationCode).toLowerCase() : null;
      const existing = (stId && wlById.get(stId)) || (stCode && wlByCode.get(stCode));

      if (existing) {
        if (item.waterlevelDischarge !== undefined && item.waterlevelDischarge !== null) {
          existing.waterlevelDischarge = item.waterlevelDischarge;
        }
        if (existing.minBank == null && item.minBank != null) existing.minBank = item.minBank;
        if (existing.storagePercent == null && item.storagePercent != null) existing.storagePercent = item.storagePercent;
        if (existing.diffWlBank == null && item.diffWlBank != null) existing.diffWlBank = item.diffWlBank;
        if (existing.diffWlBankText == null && item.diffWlBankText != null) existing.diffWlBankText = item.diffWlBankText;
      } else {
        if (stId) wlById.set(stId, item);
        if (stCode) wlByCode.set(stCode, item);
        if (st?.oldStationCode) wlByCode.set(String(st.oldStationCode).toLowerCase(), item);
      }
    }

    // 2.3 Merge canal data
    for (const item of canalItems) {
      const st = item.station;
      const stId = st?.id ? String(st.id) : null;
      const stCode = st?.stationCode ? String(st.stationCode).toLowerCase() : null;
      const existing = (stId && wlById.get(stId)) || (stCode && wlByCode.get(stCode));

      if (!existing) {
        const canalItem: ThaiWaterBulkWaterlevelItem = {
          id: item.id,
          type: item.type,
          waterlevelDatetime: item.measureAt,
          waterlevelMsl: item.measureValue,
          storagePercent: item.storagePercent,
          station: item.station,
          basin: item.basin,
        };
        if (stId) wlById.set(stId, canalItem);
        if (stCode) wlByCode.set(stCode, canalItem);
      }
    }

    // 3. Query Active Basins and Stations from PostgreSQL
    const activeBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins).where(eq(basins.isActive, true));

    let totalStations = 0;
    let synced = 0;
    let failed = 0;
    const errors: any[] = [];

    const recordsToUpsert: (typeof telemetryLatest.$inferInsert)[] = [];
    const r2CurrentUpdates: { path: string; payload: StationCurrentDataset }[] = [];

    for (const b of activeBasins) {
      const rainList = await db.select().from(rainfallStations).where(eq(rainfallStations.basinId, b.id));
      const waterList = await db.select().from(waterlevelStations).where(eq(waterlevelStations.basinId, b.id));
      totalStations += rainList.length + waterList.length;

      // Track basin rain observations for upstream correlation
      const basinRainObservations: Array<{
        rain1h: number;
        rain3h: number;
        rain24h: number;
        lat: number;
        nameTh: string;
        nameEn: string;
      }> = [];

      // 3.1 Process Rainfall Stations
      for (const st of rainList) {
        const obs =
          rainById.get(st.id) ||
          (st.oldcode && rainByCode.get(st.oldcode.toLowerCase())) ||
          null;

        if (!obs) {
          failed++;
          continue;
        }

        const rawTime = obs.measureAt || obs.rainfallDatetime || new Date().toISOString();
        const latestTime = new Date(rawTime);
        const rain24h = typeof obs.measureValue === "number" ? obs.measureValue : obs.rainfall24h ?? 0;
        const rainToday = typeof obs.rainfallToday === "number" ? obs.rainfallToday : rain24h * 0.7;
        const rain1h = 0;
        const rain3h = 0;
        const rain6h = 0;

        const situationStatus = this.evaluateSituationStatus({
          isWaterlevel: false,
          rain24h,
          warningRain24h: st.warningRain24h || 35.0,
          criticalRain24h: st.criticalRain24h || 90.0,
        });

        let alertReasonTh: string | null = null;
        let alertReasonEn: string | null = null;
        if (situationStatus === "critical") {
          alertReasonTh = `ฝนตกหนักมากสะสม 24 ชม. ${rain24h.toFixed(1)} มม. เสี่ยงน้ำท่วมฉับพลันและน้ำป่าไหลหลาก`;
          alertReasonEn = `Critical heavy rainfall: 24h ${rain24h.toFixed(1)} mm. High flash flood risk.`;
        } else if (situationStatus === "warning") {
          alertReasonTh = `ฝนตกหนักสะสม 24 ชม. ${rain24h.toFixed(1)} มม. โปรดเฝ้าระวังน้ำท่วมขังและน้ำหลาก`;
          alertReasonEn = `Heavy rainfall alert: 24h ${rain24h.toFixed(1)} mm. Flood watch advised.`;
        } else if (situationStatus === "watch") {
          alertReasonTh = `มีฝนตกต่อเนื่องสะสม 24 ชม. ${rain24h.toFixed(1)} มม.`;
          alertReasonEn = `Continuous moderate-to-heavy rain: 24h ${rain24h.toFixed(1)} mm.`;
        }

        const freshness = this.calculateFreshness(latestTime);

        recordsToUpsert.push({
          stationId: st.id,
          basinId: st.basinId,
          timestamp: latestTime,
          rainfall1h: rain1h,
          rainfall3h: rain3h,
          rainfall6h: rain6h,
          rainfall24h: rain24h,
          rainfallToday: rainToday,
          situationStatus,
          freshnessStatus: freshness,
          alertReasonTh,
          alertReasonEn,
          isUpstreamAlert: "false",
          updatedAt: new Date(),
        });

        if (writeStationCurrentJson) {
          const currentPayload: StationCurrentDataset = {
            schemaVersion: "1.0",
            datasetVersion: new Date().toISOString(),
            stationId: st.id,
            basin: b.slug,
            type: "rainfall",
            timestamp: latestTime.toISOString(),
            status: situationStatus,
            freshness,
            alertReason: alertReasonTh ? { th: alertReasonTh, en: alertReasonEn || "" } : undefined,
            isUpstreamAlert: false,
            rainfall: {
              value1h: rain1h,
              value3h: rain3h,
              value6h: rain6h,
              value24h: rain24h,
              valueToday: rainToday,
              intensity: this.calculateRainIntensity(rain24h),
            },
            updatedAt: new Date().toISOString(),
          };
          r2CurrentUpdates.push({
            path: `rainfall_station/${b.slug}/${st.id}/current.json`,
            payload: currentPayload,
          });
        }

        basinRainObservations.push({
          rain1h,
          rain3h,
          rain24h,
          lat: st.lat,
          nameTh: st.nameTh,
          nameEn: st.nameEn,
        });

        synced++;
      }

      // 3.2 Process Waterlevel Stations
      for (const st of waterList) {
        const obs =
          wlById.get(st.id) ||
          (st.oldcode && wlByCode.get(st.oldcode.toLowerCase())) ||
          null;

        if (!obs) {
          failed++;
          continue;
        }

        const rawTime = obs.waterlevelDatetime || obs.measureAt || new Date().toISOString();
        const latestTime = new Date(rawTime);
        const waterLevelMsl = typeof obs.waterlevelMsl === "number" ? obs.waterlevelMsl : obs.measureValue ?? null;
        const prevMsl = typeof obs.waterlevelMslPrevious === "number" ? obs.waterlevelMslPrevious : null;
        const discharge = typeof obs.waterlevelDischarge === "number" ? obs.waterlevelDischarge : null;

        const groundLevel = obs.station?.groundLevel ?? st.groundLevel;
        const stage =
          waterLevelMsl !== null && groundLevel !== null && groundLevel !== undefined
            ? Math.round((waterLevelMsl - groundLevel) * 100) / 100
            : waterLevelMsl;

        const bankLevel = obs.minBank ?? st.minBank;
        let storagePercent = obs.storagePercent ?? null;
        if (storagePercent === null && bankLevel && waterLevelMsl !== null) {
          if (groundLevel !== null && groundLevel !== undefined && bankLevel > groundLevel) {
            storagePercent = Math.min(150, Math.max(0, Math.round(((waterLevelMsl - groundLevel) / (bankLevel - groundLevel)) * 100)));
          } else {
            storagePercent = Math.min(150, Math.max(0, Math.round((waterLevelMsl / bankLevel) * 100)));
          }
        }

        let situationStatus = this.evaluateSituationStatus({
          isWaterlevel: true,
          diffWlBank: obs.diffWlBank,
          diffWlBankText: obs.diffWlBankText,
          storagePercent,
        });

        // Upstream Rainfall Correlation
        let isUpstreamAlert = false;
        let upstreamAlertTh: string | null = null;
        let upstreamAlertEn: string | null = null;

        const heavyUpstream = basinRainObservations.filter((r) => {
          const isUpstreamReach = r.lat >= st.lat - 0.05;
          return isUpstreamReach && r.rain24h >= 80.0;
        });

        if (heavyUpstream.length > 0) {
          const topRain = heavyUpstream.sort((a, b) => b.rain24h - a.rain24h)[0];
          isUpstreamAlert = true;
          upstreamAlertTh = `ขณะนี้มีฝนตกหนักที่ต้นน้ำ (สถานี ${topRain.nameTh} ฝน 24 ชม. ${topRain.rain24h.toFixed(1)} มม.) โปรดเฝ้าระวังมวลน้ำหลาก`;
          upstreamAlertEn = `Heavy upstream rainfall at ${topRain.nameEn} (24h: ${topRain.rain24h.toFixed(1)} mm). Watch for downstream runoff.`;

          if (situationStatus === "normal") {
            situationStatus = topRain.rain24h >= 120.0 ? "warning" : "watch";
          }
        }

        let alertReasonTh = upstreamAlertTh;
        let alertReasonEn = upstreamAlertEn;

        if (!alertReasonTh) {
          if (situationStatus === "critical") {
            alertReasonTh = `ระดับน้ำล้นตลิ่ง (${waterLevelMsl} ม.รทก. / ${storagePercent ?? 100}% ของความจุตลิ่ง) วิกฤตน้ำท่วม`;
            alertReasonEn = `River level exceeds bank capacity (${waterLevelMsl} m MSL / ${storagePercent ?? 100}%). Critical overflow.`;
          } else if (situationStatus === "warning") {
            alertReasonTh = `ระดับน้ำใกล้ล้นตลิ่ง (${waterLevelMsl} ม.รทก. / ${storagePercent ?? 85}% ของความจุตลิ่ง) เตือนภัย`;
            alertReasonEn = `River level near bank capacity (${waterLevelMsl} m MSL / ${storagePercent ?? 85}%). Warning stage.`;
          } else if (situationStatus === "watch") {
            alertReasonTh = `ระดับน้ำขึ้นสูง (${waterLevelMsl} ม.รทก. / ${storagePercent ?? 70}% ของความจุตลิ่ง) เฝ้าระวัง`;
            alertReasonEn = `Elevated river stage (${waterLevelMsl} m MSL / ${storagePercent ?? 70}%). Watch criteria.`;
          }
        }

        const trend = this.calculateTrend(waterLevelMsl, prevMsl);
        const freshness = this.calculateFreshness(latestTime);

        recordsToUpsert.push({
          stationId: st.id,
          basinId: st.basinId,
          timestamp: latestTime,
          stage,
          discharge,
          waterLevelMsl,
          storagePercent,
          trend,
          situationStatus,
          freshnessStatus: freshness,
          alertReasonTh,
          alertReasonEn,
          isUpstreamAlert: isUpstreamAlert ? "true" : "false",
          updatedAt: new Date(),
        });

        if (writeStationCurrentJson) {
          const currentPayload: StationCurrentDataset = {
            schemaVersion: "1.0",
            datasetVersion: new Date().toISOString(),
            stationId: st.id,
            basin: b.slug,
            type: "water_level",
            timestamp: latestTime.toISOString(),
            status: situationStatus,
            freshness,
            alertReason: alertReasonTh ? { th: alertReasonTh, en: alertReasonEn || "" } : undefined,
            isUpstreamAlert,
            waterLevel: {
              stage,
              discharge,
              waterLevelMsl,
              storagePercent,
              trend,
            },
            updatedAt: new Date().toISOString(),
          };
          r2CurrentUpdates.push({
            path: `waterlevel_station/${b.slug}/${st.id}/current.json`,
            payload: currentPayload,
          });
        }

        synced++;
      }
    }

    // 4. Batch Database Upsert (Deduplicate by stationId to prevent PostgreSQL 21000 ON CONFLICT error)
    const uniqueRecordsMap = new Map<string, typeof telemetryLatest.$inferInsert>();
    for (const rec of recordsToUpsert) {
      uniqueRecordsMap.set(rec.stationId, rec);
    }
    const deduplicatedRecords = Array.from(uniqueRecordsMap.values());

    const tDbStart = Date.now();
    const CHUNK_SIZE = 500;
    console.log(`💾 [BulkIngestion] Upserting ${deduplicatedRecords.length} unique records into PostgreSQL in chunks of ${CHUNK_SIZE}...`);

    for (let i = 0; i < deduplicatedRecords.length; i += CHUNK_SIZE) {
      const chunk = deduplicatedRecords.slice(i, i + CHUNK_SIZE);
      await db
        .insert(telemetryLatest)
        .values(chunk)
        .onConflictDoUpdate({
          target: telemetryLatest.stationId,
          set: {
            timestamp: sql`EXCLUDED.timestamp`,
            stage: sql`EXCLUDED.stage`,
            discharge: sql`EXCLUDED.discharge`,
            waterLevelMsl: sql`EXCLUDED.water_level_msl`,
            storagePercent: sql`EXCLUDED.storage_percent`,
            rainfall1h: sql`EXCLUDED.rainfall_1h`,
            rainfall3h: sql`EXCLUDED.rainfall_3h`,
            rainfall6h: sql`EXCLUDED.rainfall_6h`,
            rainfall24h: sql`EXCLUDED.rainfall_24h`,
            rainfallToday: sql`EXCLUDED.rainfall_today`,
            trend: sql`EXCLUDED.trend`,
            situationStatus: sql`EXCLUDED.situation_status`,
            freshnessStatus: sql`EXCLUDED.freshness_status`,
            alertReasonTh: sql`EXCLUDED.alert_reason_th`,
            alertReasonEn: sql`EXCLUDED.alert_reason_en`,
            isUpstreamAlert: sql`EXCLUDED.is_upstream_alert`,
            updatedAt: new Date(),
          },
        });
    }
    console.log(`✅ [BulkIngestion] PostgreSQL batch upsert completed in ${Date.now() - tDbStart}ms`);

    // 5. Update R2 Snapshots
    // 5.1 Station current.json (Chunked concurrency)
    if (writeStationCurrentJson && r2CurrentUpdates.length > 0) {
      const uniqueR2Map = new Map<string, { path: string; payload: StationCurrentDataset }>();
      for (const u of r2CurrentUpdates) {
        uniqueR2Map.set(u.path, u);
      }
      const deduplicatedR2 = Array.from(uniqueR2Map.values());

      const tR2Start = Date.now();
      console.log(`📦 [BulkIngestion] Overwriting ${deduplicatedR2.length} station current.json on R2...`);
      const R2_CONCURRENCY = 50;
      for (let i = 0; i < deduplicatedR2.length; i += R2_CONCURRENCY) {
        const batch = deduplicatedR2.slice(i, i + R2_CONCURRENCY);
        await Promise.all(
          batch.map((item) =>
            r2Storage
              .putJson(item.path, item.payload, "public, max-age=60, s-maxage=60")
              .catch((err) =>
                console.warn(`⚠️ Warning writing current.json for ${item.path}:`, err.message)
              )
          )
        );
      }
      console.log(`✅ [BulkIngestion] Station current.json files updated in ${Date.now() - tR2Start}ms`);
    }

    // 5.2 Basin Overview & Station Snapshots on R2
    for (const b of activeBasins) {
      try {
        await r2Publisher.publishBasinStationsList(b.slug);
        await r2Publisher.publishBasinOverview(b.slug);
      } catch (pubErr: any) {
        console.warn(`⚠️ Warning publishing R2 aggregates for basin ${b.slug}:`, pubErr.message);
      }
    }

    // 5.3 Root basins.json
    try {
      await r2Publisher.publishBasinsList();
    } catch (pubErr: any) {
      // Continue
    }

    const durationMs = Date.now() - t0;
    console.log(
      `🎉 [BulkIngestion] Complete! Synced: ${synced}, Inactive/Unmatched: ${failed}, Total: ${totalStations} in ${(
        durationMs / 1000
      ).toFixed(2)}s`
    );

    return {
      success: true,
      total: totalStations,
      synced,
      failed,
      durationMs,
      endpoints: {
        rainfallCount: rainItems.length,
        waterlevelCount: wlItems.length,
        dischargeCount: dischargeItems.length,
        canalCount: canalItems.length,
      },
      errors,
    };
  }
}

export const thaiWaterBulkIngestion = new ThaiWaterBulkIngestionService();
