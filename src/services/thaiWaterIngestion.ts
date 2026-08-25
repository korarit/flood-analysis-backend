import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { basins, stations, telemetryHistory, telemetryLatest } from "../db/schema";
import { FreshnessStatus, RainIntensity, SituationStatus, TrendDirection } from "../types";

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

  /**
   * Format Date to ThaiWater API query format: "YYYY-MM-DD HH:mm"
   */
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
   * Fetch Hourly Rainfall Graph data
   */
  async fetchRainfallGraph(
    stationId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{ data: ThaiWaterHourlyRainItem[] } | null> {
    const end = endDate || this.formatDateTime(new Date());
    const startObj = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
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
   * Fetch Water Level & Discharge Graph data
   */
  async fetchWaterLevelGraph(
    stationId: string,
    startDate?: string,
    endDate?: string
  ): Promise<ThaiWaterWaterLevelResponse | null> {
    const end = endDate || this.formatDateTime(new Date());
    const startObj = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
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

  /**
   * Helper to calculate Rain Intensity
   */
  public calculateRainIntensity(rain24h: number | null): RainIntensity {
    if (rain24h === null || rain24h < 10) return "light";
    if (rain24h <= 35) return "moderate";
    if (rain24h <= 90) return "heavy";
    return "very_heavy";
  }

  /**
   * Helper to calculate Freshness
   */
  public calculateFreshness(timestamp: Date): FreshnessStatus {
    const diffMs = Date.now() - timestamp.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 1.5) return "fresh";
    if (diffHours <= 3.5) return "delayed";
    return "missing";
  }

  /**
   * Helper to determine Trend direction from sequential values
   */
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
   * Sync telemetry for a single station from ThaiWater API and persist to DB
   */
  async syncStation(stationRecord: typeof stations.$inferSelect): Promise<boolean> {
    const sourceId = stationRecord.sourceStationId || stationRecord.id;

    if (stationRecord.type === "rainfall") {
      const rainRes = await this.fetchRainfallGraph(sourceId);
      if (!rainRes || !rainRes.data || rainRes.data.length === 0) {
        return false;
      }

      // Filter valid entries with value
      const items = rainRes.data.filter((d) => d.value !== null);
      if (items.length === 0) return false;

      const latestItem = items[items.length - 1];
      const latestTime = new Date(latestItem.datetime);
      const rain1h = latestItem.value || 0;

      // Calculate 3h, 6h, 24h rainfall sums
      const last3Items = items.slice(-3);
      const rain3h = last3Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

      const last6Items = items.slice(-6);
      const rain6h = last6Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

      const last24Items = items.slice(-24);
      const rain24h = last24Items.reduce((acc, curr) => acc + (curr.value || 0), 0);

      // Situation status & Alert Reason thresholds (Flash Rain & Intensity criteria)
      let situationStatus: SituationStatus = "normal";
      let alertReasonTh: string | null = null;
      let alertReasonEn: string | null = null;

      // 1. Critical Rule (Flash flood / Extreme heavy rain)
      if (
        rain24h >= 150.0 ||
        rain3h >= 100.0 ||
        (rain24h >= 100.0 && (rain3h >= 30.0 || rain1h >= 30.0))
      ) {
        situationStatus = "critical";
        alertReasonTh = `ฝนตกหนักมากสะสม 24 ชม. ${rain24h.toFixed(1)} มม. (3 ชม. ${rain3h.toFixed(1)} มม., 1 ชม. ${rain1h.toFixed(1)} มม.) เสี่ยงน้ำท่วมฉับพลันและน้ำป่าไหลหลาก`;
        alertReasonEn = `Critical heavy rainfall: 24h ${rain24h.toFixed(1)} mm, 3h ${rain3h.toFixed(1)} mm. High flash flood risk.`;
      }
      // 2. Warning Rule (Heavy rain / Significant accumulation)
      else if (
        rain24h >= 100.0 ||
        (rain24h >= 90.0 && rain3h >= 20.0) ||
        rain3h >= 50.0 ||
        rain1h >= 30.0
      ) {
        situationStatus = "warning";
        alertReasonTh = `ฝนตกหนักสะสม 24 ชม. ${rain24h.toFixed(1)} มม. (3 ชม. ${rain3h.toFixed(1)} มม., 1 ชม. ${rain1h.toFixed(1)} มม.) โปรดเฝ้าระวังน้ำท่วมขังและน้ำหลาก`;
        alertReasonEn = `Heavy rainfall alert: 24h ${rain24h.toFixed(1)} mm, 3h ${rain3h.toFixed(1)} mm. Flood watch advised.`;
      }
      // 3. Watch Rule (Moderate-heavy rain)
      else if (rain24h >= 35.0 || rain3h >= 20.0 || rain1h >= 15.0) {
        situationStatus = "watch";
        alertReasonTh = `มีฝนตกต่อเนื่องสะสม 24 ชม. ${rain24h.toFixed(1)} มม. (3 ชม. ${rain3h.toFixed(1)} มม.)`;
        alertReasonEn = `Continuous moderate-to-heavy rain: 24h ${rain24h.toFixed(1)} mm.`;
      }

      const freshness = this.calculateFreshness(latestTime);

      // Upsert telemetry_latest
      await db
        .insert(telemetryLatest)
        .values({
          stationId: stationRecord.id,
          basinId: stationRecord.basinId,
          timestamp: latestTime,
          rainfall1h: rain1h,
          rainfall3h: rain3h,
          rainfall6h: rain6h,
          rainfall24h: rain24h,
          rainfallToday: rain24h * 0.7, // approximate
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
            isUpstreamAlert: "false",
            updatedAt: new Date(),
          },
        });

      return true;
    } else {
      // Water level station
      const wlRes = await this.fetchWaterLevelGraph(sourceId);
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

      // Extract thresholds from API or Station Master, with standard hydrological fallbacks (§2.2)
      const bankLevel = mainData.minBank || stationRecord.bankLevelMsl;
      const criticalLevel = mainData.criticalLevel || stationRecord.criticalLevelMsl || bankLevel;
      const warningLevel =
        mainData.warningLevel || stationRecord.warningLevelMsl || (bankLevel ? bankLevel * 0.85 : null);
      const watchLevel = bankLevel ? bankLevel * 0.7 : null;

      // Determine situation status from local water level stage
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

      // Storage percent relative to bank
      let storagePercent: number | null = null;
      if (bankLevel && stage !== null) {
        storagePercent = Math.min(120, Math.max(0, Math.round((stage / bankLevel) * 100)));
      }

      // Check Upstream Rainfall Influence across the Basin
      let isUpstreamAlert = false;
      let upstreamAlertTh: string | null = null;
      let upstreamAlertEn: string | null = null;

      try {
        const { and } = await import("drizzle-orm");
        const upstreamRainList = await db
          .select({
            id: stations.id,
            nameTh: stations.nameTh,
            nameEn: stations.nameEn,
            lat: stations.lat,
            rain1h: telemetryLatest.rainfall1h,
            rain3h: telemetryLatest.rainfall3h,
            rain24h: telemetryLatest.rainfall24h,
          })
          .from(stations)
          .innerJoin(telemetryLatest, eq(stations.id, telemetryLatest.stationId))
          .where(
            and(
              eq(stations.basinId, stationRecord.basinId),
              eq(stations.type, "rainfall")
            )
          );

        // Filter upstream (higher latitude) or severe rainfall stations in basin
        const heavyUpstream = upstreamRainList.filter((r) => {
          const isUpstreamReach = r.lat >= stationRecord.lat - 0.05; // Upstream reach
          const rain24 = r.rain24h || 0;
          const rain3 = r.rain3h || 0;
          const rain1 = r.rain1h || 0;

          return (
            isUpstreamReach &&
            (rain24 >= 100.0 ||
              rain3 >= 100.0 ||
              (rain24 >= 100.0 && (rain3 >= 30.0 || rain1 >= 30.0)) ||
              (rain24 >= 80.0 && rain3 >= 20.0))
          );
        });

        if (heavyUpstream.length > 0) {
          const topRain = heavyUpstream.sort((a, b) => (b.rain24h || 0) - (a.rain24h || 0))[0];
          isUpstreamAlert = true;
          const rain24Str = (topRain.rain24h || 0).toFixed(1);
          const rain3Str = (topRain.rain3h || 0).toFixed(1);

          // Use model-computed arrival time if available from station metadata / external model
          let timePhraseTh = "อย่างใกล้ชิด";
          let timePhraseEn = "closely";

          if (stationRecord.lagTimeHoursMin && stationRecord.lagTimeHoursMax) {
            timePhraseTh = `ในอีกประมาณ ${stationRecord.lagTimeHoursMin} - ${stationRecord.lagTimeHoursMax} ชั่วโมง`;
            timePhraseEn = `in approximately ${stationRecord.lagTimeHoursMin} - ${stationRecord.lagTimeHoursMax} hours`;
          } else if (stationRecord.lagTimeHours) {
            timePhraseTh = `ในอีกประมาณ ${stationRecord.lagTimeHours} ชั่วโมง`;
            timePhraseEn = `in approximately ${stationRecord.lagTimeHours} hours`;
          }

          upstreamAlertTh = `ขณะนี้มีฝนตกหนักที่ต้นน้ำ (สถานี ${topRain.nameTh} ฝน 24 ชม. ${rain24Str} มม., 3 ชม. ${rain3Str} มม.) โปรดเฝ้าระวังระดับน้ำและมวลน้ำหลากที่จะไหลลงสู่พื้นที่นี้ ${timePhraseTh}`;
          upstreamAlertEn = `Heavy upstream rainfall at ${topRain.nameEn} (24h: ${rain24Str} mm, 3h: ${rain3Str} mm). Watch for downstream flood runoff ${timePhraseEn}.`;

          // Escalate situation status if upstream has extreme rain
          if (situationStatus === "normal") {
            situationStatus = (topRain.rain24h || 0) >= 120.0 || (topRain.rain3h || 0) >= 60.0 ? "warning" : "watch";
          } else if (situationStatus === "watch") {
            situationStatus = "warning";
          }
        }
      } catch (err) {
        console.warn("Could not evaluate upstream rain correlation:", err);
      }

      // Combine alert reasons
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

      // Determine trend
      const recentValues = validPoints.slice(-5).map((p) => p.value);
      const trend = this.calculateTrend(recentValues);
      const freshness = this.calculateFreshness(latestTime);

      // Upsert telemetry_latest
      await db
        .insert(telemetryLatest)
        .values({
          stationId: stationRecord.id,
          basinId: stationRecord.basinId,
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
          estimatedArrivalHoursMin: stationRecord.lagTimeHoursMin || null,
          estimatedArrivalHoursMax: stationRecord.lagTimeHoursMax || null,
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
            estimatedArrivalHoursMin: stationRecord.lagTimeHoursMin || null,
            estimatedArrivalHoursMax: stationRecord.lagTimeHoursMax || null,
            updatedAt: new Date(),
          },
        });

      return true;
    }
  }

  /**
   * Sync telemetry for all active stations (optionally filtered by basin)
   * Syncs rainfall stations first so that water level stations can correlate upstream rain immediately.
   */
  async syncAllTelemetry(targetBasinId?: string): Promise<{
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    errors: any[];
  }> {
    const allStations = targetBasinId
      ? await db.select().from(stations).where(eq(stations.basinId, targetBasinId))
      : await db.select().from(stations);

    // Prioritize rainfall stations first
    const sortedStations = [...allStations].sort((a, b) => {
      if (a.type === "rainfall" && b.type !== "rainfall") return -1;
      if (a.type !== "rainfall" && b.type === "rainfall") return 1;
      return 0;
    });

    let synced = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const st of sortedStations) {
      try {
        const ok = await this.syncStation(st);
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

    return {
      success: true,
      total: allStations.length,
      synced,
      failed,
      errors,
    };
  }
}

export const thaiWaterIngestion = new ThaiWaterIngestionService();
