import { and, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { basins, rainfallStations, telemetryLatest, waterlevelStations } from "../db/schema";
import { FreshnessStatus, RainIntensity, SituationStatus, StationCurrentDataset, TrendDirection } from "../types";
import { r2Publisher } from "./r2PublisherService";
import { r2Storage } from "./r2StorageService";

export interface ThaiWaterHourlyRainItem {
  datetime: string;
  value: number | null;
}

export interface ThaiWaterWaterLevelDataPoint {
  datetime: string;
  value: number | null;
  valueOut?: number | null;
  discharge?: number | null;
}

export interface ThaiWaterWaterLevelResponse {
  meta?: any;
  data?: Array<{
    id: number;
    type: string;
    data: ThaiWaterWaterLevelDataPoint[];
    minBank?: number | null;
    warningLevel?: number | null;
    criticalLevel?: number | null;
    groundLevel?: number | null;
    qmax?: number | null;
  }>;
  included?: {
    attributes?: {
      station?: { th: string; en: string; jp: string };
      latitude?: string;
      longitude?: string;
      groundLevel?: number | null;
      minBank?: number | null;
    };
  };
}

export class ThaiWaterIngestionService {
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
      accept: "application/json, text/plain, */*",
      "accept-language": "th",
    };
  }

  private formatDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const mins = pad(d.getMinutes());
    return `${year}-${month}-${day} ${hours}:${mins}`;
  }

  /**
   * Fetch Day-by-Day (Last 24h or specified range) Hourly Rainfall Graph data
   */
  async fetchRainfallGraph(
    stationId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{ data: ThaiWaterHourlyRainItem[] } | null> {
    const end = endDate || this.formatDateTime(new Date());
    // Default to Day-by-Day (1 day ago)
    const startObj = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const start = startDate || this.formatDateTime(startObj);

    const url = new URL(`${this.baseUrl}/data/platform/v1/public/rainfall_c60/graph`);
    url.searchParams.set("timezone", "7");
    url.searchParams.set("stationId", stationId);
    url.searchParams.set("limit", "-1");
    url.searchParams.set("sort", "measureAt");
    url.searchParams.set("interval", "hourly");
    url.searchParams.set("startDate", start);
    url.searchParams.set("endDate", end);

    try {
      const response = await fetch(url.toString(), {
        headers: this.getRequestHeaders(),
      });

      if (!response.ok) {
        console.error(`❌ ThaiWater rainfall API error ${response.status} for station ${stationId}`);
        return null;
      }

      return (await response.json()) as { data: ThaiWaterHourlyRainItem[] };
    } catch (err) {
      console.error(`❌ Failed to fetch rainfall graph for station ${stationId}`, err);
      return null;
    }
  }

  /**
   * Fetch Day-by-Day (Last 24h or specified range) Water Level & Discharge Graph data
   */
  async fetchWaterLevelGraph(
    stationId: string,
    startDate?: string,
    endDate?: string
  ): Promise<ThaiWaterWaterLevelResponse | null> {
    const end = endDate || this.formatDateTime(new Date());
    // Default to Day-by-Day (1 day ago)
    const startObj = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const start = startDate || this.formatDateTime(startObj);

    const url = new URL(`${this.baseUrl}/data/platform/v1/public/tele_waterlevel/graph`);
    url.searchParams.set("stationId", stationId);
    url.searchParams.set("limit", "-1");
    url.searchParams.set("startDate", start);
    url.searchParams.set("endDate", end);

    try {
      const response = await fetch(url.toString(), {
        headers: this.getRequestHeaders(),
      });

      if (!response.ok) {
        console.error(`❌ ThaiWater waterlevel API error ${response.status} for station ${stationId}`);
        return null;
      }

      return (await response.json()) as ThaiWaterWaterLevelResponse;
    } catch (err) {
      console.error(`❌ Failed to fetch waterlevel graph for station ${stationId}`, err);
      return null;
    }
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

  public calculateTrend(values: (number | null)[]): TrendDirection {
    const valid = values.filter((v): v is number => v !== null && typeof v === "number");
    if (valid.length < 2) return "steady";
    const last = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    const diff = last - prev;
    if (diff > 0.05) return "rising";
    if (diff < -0.05) return "falling";
    return "steady";
  }

  /**
   * Helper: Append daily observations to 7-Day Chunk Timeseries file on R2.
   * If the accumulated observations span >= 7 days, complete the chunk file
   * (e.g. 7d_{start}_{end}.json) and start a fresh 7-day chunk!
   */
  private async append7DayChunkHistory(
    basinSlug: string,
    stationId: string,
    stationType: "rainfall" | "water_level",
    newObservations: Array<{ timestamp: string; stage?: number | null; discharge?: number | null; rainfall?: number | null }>
  ) {
    if (newObservations.length === 0) return;

    const folderPrefix =
      stationType === "rainfall"
        ? `rainfall_station/${basinSlug}/${stationId}`
        : `waterlevel_station/${basinSlug}/${stationId}`;

    const active7dPath = `${folderPrefix}/history/latest-7d.json`;
    const existing = (await r2Storage.getJson(active7dPath)) as {
      stationId: string;
      observations: Array<{ timestamp: string; stage?: number | null; discharge?: number | null; rainfall?: number | null }>;
      startDate?: string;
    } | null;

    // Merge and deduplicate by timestamp
    const obsMap = new Map<string, any>();
    if (existing && Array.isArray(existing.observations)) {
      for (const o of existing.observations) {
        obsMap.set(o.timestamp, o);
      }
    }
    for (const o of newObservations) {
      obsMap.set(o.timestamp, o);
    }

    const merged = Array.from(obsMap.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const minTime = new Date(merged[0].timestamp).getTime();
    const maxTime = new Date(merged[merged.length - 1].timestamp).getTime();
    const spanDays = (maxTime - minTime) / (1000 * 60 * 60 * 24);

    const startDateStr = new Date(minTime).toISOString().split("T")[0];
    const endDateStr = new Date(maxTime).toISOString().split("T")[0];

    // Check if 7 days are complete
    if (spanDays >= 7) {
      // 1. Archive the completed 7-day file
      const completedPath = `${folderPrefix}/history/7d_${startDateStr}_to_${endDateStr}.json`;
      const completedPayload = {
        schemaVersion: "1.0",
        stationId,
        basin: basinSlug,
        type: stationType,
        startDate: startDateStr,
        endDate: endDateStr,
        totalObservations: merged.length,
        observations: merged,
        isCompleted: true,
        finalizedAt: new Date().toISOString(),
      };
      await r2Storage.putJson(completedPath, completedPayload, "public, max-age=604800, s-maxage=604800");

      // 2. Reset latest-7d.json with only the newest day's observations for the new 7-day cycle
      const recentDayObs = merged.filter(
        (o) => maxTime - new Date(o.timestamp).getTime() <= 24 * 60 * 60 * 1000
      );
      const newCyclePayload = {
        schemaVersion: "1.0",
        stationId,
        basin: basinSlug,
        type: stationType,
        startDate: new Date(recentDayObs[0]?.timestamp || maxTime).toISOString().split("T")[0],
        totalObservations: recentDayObs.length,
        observations: recentDayObs,
        isCompleted: false,
        updatedAt: new Date().toISOString(),
      };
      await r2Storage.putJson(active7dPath, newCyclePayload, "public, max-age=180, s-maxage=180");
    } else {
      // Still accumulating in current 7-day chunk
      const payload = {
        schemaVersion: "1.0",
        stationId,
        basin: basinSlug,
        type: stationType,
        startDate: startDateStr,
        totalObservations: merged.length,
        observations: merged,
        isCompleted: false,
        updatedAt: new Date().toISOString(),
      };
      await r2Storage.putJson(active7dPath, payload, "public, max-age=180, s-maxage=180");
    }
  }

  /**
   * Sync single rainfall station:
   * 1. Fetches day-by-day telemetry
   * 2. Overwrites current.json directly on R2 (Replace)
   * 3. Appends/Rotates 7-day timeseries on R2
   */
  async syncRainfallStation(
    st: typeof rainfallStations.$inferSelect,
    basinSlug: string
  ): Promise<{ ok: boolean; latestRain?: { rain1h: number; rain3h: number; rain24h: number; lat: number; nameTh: string; nameEn: string } }> {
    const rainRes = await this.fetchRainfallGraph(st.id);
    if (!rainRes || !rainRes.data || rainRes.data.length === 0) {
      return { ok: false };
    }

    const items = rainRes.data.filter((d) => d.value !== null);
    if (items.length === 0) return { ok: false };

    const latestItem = items[items.length - 1];
    const latestTime = new Date(latestItem.datetime);
    const rain1h = latestItem.value || 0;

    const last3Items = items.slice(-3);
    const rain3h = last3Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

    const last6Items = items.slice(-6);
    const rain6h = last6Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

    const last24Items = items.slice(-24);
    const rain24h = last24Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

    let situationStatus: SituationStatus = "normal";
    let alertReasonTh: string | null = null;
    let alertReasonEn: string | null = null;

    if (rain24h >= 150.0 || rain3h >= 100.0 || (rain24h >= 100.0 && (rain3h >= 30.0 || rain1h >= 30.0))) {
      situationStatus = "critical";
      alertReasonTh = `ฝนตกหนักมากสะสม 24 ชม. ${rain24h.toFixed(1)} มม. เสี่ยงน้ำท่วมฉับพลันและน้ำป่าไหลหลาก`;
      alertReasonEn = `Critical heavy rainfall: 24h ${rain24h.toFixed(1)} mm. High flash flood risk.`;
    } else if (rain24h >= 100.0 || (rain24h >= 90.0 && rain3h >= 20.0) || rain3h >= 50.0 || rain1h >= 30.0) {
      situationStatus = "warning";
      alertReasonTh = `ฝนตกหนักสะสม 24 ชม. ${rain24h.toFixed(1)} มม. โปรดเฝ้าระวังน้ำท่วมขังและน้ำหลาก`;
      alertReasonEn = `Heavy rainfall alert: 24h ${rain24h.toFixed(1)} mm. Flood watch advised.`;
    } else if (rain24h >= 35.0 || rain3h >= 20.0 || rain1h >= 15.0) {
      situationStatus = "watch";
      alertReasonTh = `มีฝนตกต่อเนื่องสะสม 24 ชม. ${rain24h.toFixed(1)} มม.`;
      alertReasonEn = `Continuous moderate-to-heavy rain: 24h ${rain24h.toFixed(1)} mm.`;
    }

    const freshness = this.calculateFreshness(latestTime);

    // 1. Overwrite / Replace current.json directly on R2
    const currentPayload: StationCurrentDataset = {
      schemaVersion: "1.0",
      datasetVersion: new Date().toISOString(),
      stationId: st.id,
      basin: basinSlug,
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
        valueToday: rain24h * 0.7,
        intensity: this.calculateRainIntensity(rain24h),
      },
      updatedAt: new Date().toISOString(),
    };
    const currentPath = `rainfall_station/${basinSlug}/${st.id}/current.json`;
    await r2Storage.putJson(currentPath, currentPayload, "public, max-age=60, s-maxage=60");

    // 2. Append to 7-Day Chunk Timeseries on R2
    const observations = items.map((i) => ({
      timestamp: new Date(i.datetime).toISOString(),
      rainfall: i.value,
    }));
    await this.append7DayChunkHistory(basinSlug, st.id, "rainfall", observations);

    // 3. Update telemetry_latest in DB (Secondary Cache for Fast Queries)
    await db
      .insert(telemetryLatest)
      .values({
        stationId: st.id,
        basinId: st.basinId,
        timestamp: latestTime,
        rainfall1h: rain1h,
        rainfall3h: rain3h,
        rainfall6h: rain6h,
        rainfall24h: rain24h,
        rainfallToday: rain24h * 0.7,
        situationStatus,
        freshnessStatus: freshness,
        alertReasonTh,
        alertReasonEn,
        isUpstreamAlert: "false",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: telemetryLatest.stationId,
        set: {
          timestamp: latestTime,
          rainfall1h: rain1h,
          rainfall3h: rain3h,
          rainfall6h: rain6h,
          rainfall24h: rain24h,
          rainfallToday: rain24h * 0.7,
          situationStatus,
          freshnessStatus: freshness,
          alertReasonTh,
          alertReasonEn,
          updatedAt: new Date(),
        },
      });

    return {
      ok: true,
      latestRain: {
        rain1h,
        rain3h,
        rain24h,
        lat: st.lat,
        nameTh: st.nameTh,
        nameEn: st.nameEn,
      },
    };
  }

  /**
   * Sync single water level station:
   * 1. Fetches day-by-day telemetry
   * 2. Checks upstream rainfall correlation from in-memory rain map
   * 3. Overwrites current.json directly on R2 (Replace)
   * 4. Appends/Rotates 7-day timeseries on R2
   */
  async syncWaterlevelStation(
    st: typeof waterlevelStations.$inferSelect,
    basinSlug: string,
    basinRainMap: Array<{ rain1h: number; rain3h: number; rain24h: number; lat: number; nameTh: string; nameEn: string }>
  ): Promise<boolean> {
    const wlRes = await this.fetchWaterLevelGraph(st.id);
    if (!wlRes || !wlRes.data || wlRes.data.length === 0) {
      return false;
    }

    const mainData = wlRes.data[0];
    const validPoints = (mainData.data || []).filter((d) => d.value !== null);
    if (validPoints.length === 0) return false;

    const latestPoint = validPoints[validPoints.length - 1];
    const latestTime = new Date(latestPoint.datetime);
    const stage = latestPoint.value;
    const discharge = latestPoint.discharge || null;

    const bankLevel = mainData.minBank || st.minBank;
    const criticalLevel = mainData.criticalLevel || bankLevel;
    const warningLevel = mainData.warningLevel || (bankLevel ? bankLevel * 0.85 : null);
    const watchLevel = bankLevel ? bankLevel * 0.7 : null;

    let situationStatus: SituationStatus = "normal";
    if (stage !== null) {
      if (criticalLevel && stage >= criticalLevel) {
        situationStatus = "critical";
      } else if (warningLevel && stage >= warningLevel) {
        situationStatus = "warning";
      } else if (watchLevel && stage >= watchLevel) {
        situationStatus = "watch";
      }
    }

    let storagePercent: number | null = null;
    if (bankLevel && stage !== null) {
      storagePercent = Math.min(120, Math.max(0, Math.round((stage / bankLevel) * 100)));
    }

    // Upstream Rainfall Correlation (In-Memory from basin rain stations)
    let isUpstreamAlert = false;
    let upstreamAlertTh: string | null = null;
    let upstreamAlertEn: string | null = null;

    const heavyUpstream = basinRainMap.filter((r) => {
      const isUpstreamReach = r.lat >= st.lat - 0.05;
      return isUpstreamReach && (r.rain24h >= 80.0 || r.rain3h >= 20.0);
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
        alertReasonTh = `ระดับน้ำล้นตลิ่ง (${stage} ม. / ${storagePercent}% ของความจุตลิ่ง) วิกฤตน้ำท่วม`;
        alertReasonEn = `River level exceeds bank capacity (${stage} m / ${storagePercent}%). Critical overflow.`;
      } else if (situationStatus === "warning") {
        alertReasonTh = `ระดับน้ำใกล้ล้นตลิ่ง (${stage} ม. / ${storagePercent}% ของความจุตลิ่ง) เตือนภัย`;
        alertReasonEn = `River level near bank capacity (${stage} m / ${storagePercent}%). Warning stage.`;
      } else if (situationStatus === "watch") {
        alertReasonTh = `ระดับน้ำขึ้นสูง (${stage} ม. / ${storagePercent}% ของความจุตลิ่ง) เฝ้าระวัง`;
        alertReasonEn = `Elevated river stage (${stage} m / ${storagePercent}%). Watch criteria.`;
      }
    }

    const recentValues = validPoints.slice(-5).map((p) => p.value);
    const trend = this.calculateTrend(recentValues);
    const freshness = this.calculateFreshness(latestTime);

    // 1. Overwrite / Replace current.json directly on R2
    const currentPayload: StationCurrentDataset = {
      schemaVersion: "1.0",
      datasetVersion: new Date().toISOString(),
      stationId: st.id,
      basin: basinSlug,
      type: "water_level",
      timestamp: latestTime.toISOString(),
      status: situationStatus,
      freshness,
      alertReason: alertReasonTh ? { th: alertReasonTh, en: alertReasonEn || "" } : undefined,
      isUpstreamAlert,
      waterLevel: {
        stage,
        discharge,
        waterLevelMsl: stage,
        storagePercent,
        trend,
      },
      updatedAt: new Date().toISOString(),
    };
    const currentPath = `waterlevel_station/${basinSlug}/${st.id}/current.json`;
    await r2Storage.putJson(currentPath, currentPayload, "public, max-age=60, s-maxage=60");

    // 2. Append to 7-Day Chunk Timeseries on R2
    const observations = validPoints.map((p) => ({
      timestamp: new Date(p.datetime).toISOString(),
      stage: p.value,
      discharge: p.discharge || null,
    }));
    await this.append7DayChunkHistory(basinSlug, st.id, "water_level", observations);

    // 3. Update telemetry_latest in DB (Secondary Cache for Fast Queries)
    await db
      .insert(telemetryLatest)
      .values({
        stationId: st.id,
        basinId: st.basinId,
        timestamp: latestTime,
        stage,
        discharge,
        waterLevelMsl: stage,
        storagePercent,
        trend,
        situationStatus,
        freshnessStatus: freshness,
        alertReasonTh,
        alertReasonEn,
        isUpstreamAlert: isUpstreamAlert ? "true" : "false",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: telemetryLatest.stationId,
        set: {
          timestamp: latestTime,
          stage,
          discharge,
          waterLevelMsl: stage,
          storagePercent,
          trend,
          situationStatus,
          freshnessStatus: freshness,
          alertReasonTh,
          alertReasonEn,
          isUpstreamAlert: isUpstreamAlert ? "true" : "false",
          updatedAt: new Date(),
        },
      });

    return true;
  }

  /**
   * Sync telemetry across active basins (or target basin)
   * Processes Rainfall stations first to enable in-memory upstream correlation,
   * then processes Waterlevel stations, and finishes by publishing overview & stations datasets on R2.
   */
  async syncAllTelemetry(targetBasinSlug?: string): Promise<{
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    errors: any[];
  }> {
    // Only process basins where is_active = true
    const activeBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins).where(eq(basins.isActive, true));

    let totalStations = 0;
    let synced = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const b of activeBasins) {
      const rainList = await db.select().from(rainfallStations).where(eq(rainfallStations.basinId, b.id));
      const waterList = await db.select().from(waterlevelStations).where(eq(waterlevelStations.basinId, b.id));
      totalStations += rainList.length + waterList.length;

      const basinRainObservations: Array<{ rain1h: number; rain3h: number; rain24h: number; lat: number; nameTh: string; nameEn: string }> = [];

      // 1. Sync Rainfall Stations for this basin
      for (const st of rainList) {
        try {
          const res = await this.syncRainfallStation(st, b.slug);
          if (res.ok) {
            synced++;
            if (res.latestRain) {
              basinRainObservations.push(res.latestRain);
            }
          } else {
            failed++;
          }
        } catch (err: any) {
          failed++;
          errors.push({ stationId: st.id, error: err.message });
        }
      }

      // 2. Sync Waterlevel Stations for this basin
      for (const st of waterList) {
        try {
          const ok = await this.syncWaterlevelStation(st, b.slug, basinRainObservations);
          if (ok) {
            synced++;
          } else {
            failed++;
          }
        } catch (err: any) {
          failed++;
          errors.push({ stationId: st.id, error: err.message });
        }
      }

      // 3. Auto-publish overview and station snapshots on R2 for this basin
      try {
        await r2Publisher.publishBasinStationsList(b.slug);
        await r2Publisher.publishBasinOverview(b.slug);
      } catch (pubErr) {
        console.warn(`⚠️ Warning publishing R2 aggregates for basin ${b.slug}:`, pubErr);
      }
    }

    // 4. Update root basins.json
    try {
      await r2Publisher.publishBasinsList();
    } catch (pubErr) {
      // Continue
    }

    return {
      success: true,
      total: totalStations,
      synced,
      failed,
      errors,
    };
  }
}

export const thaiWaterIngestion = new ThaiWaterIngestionService();
