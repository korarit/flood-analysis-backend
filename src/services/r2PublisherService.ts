import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins, datasetRegistry, stations, telemetryLatest } from "../db/schema";
import {
  BasinOverviewDataset,
  BasinsListDataset,
  BasinStatusSummary,
  SituationStatus,
  StationCurrentDataset,
  StationDetailDataset,
  StationListDataset,
  StationRelationItem,
  StationRelationsDataset,
  StationSnapshotItem,
} from "../types";
import { llmBulletinService } from "./llmBulletinService";
import { r2Storage } from "./r2StorageService";

export class R2PublisherService {
  private schemaVersion = "1.0";

  private getNowIso(): string {
    return new Date().toISOString();
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split("T")[0];
  }

  /**
   * Helper to register or update published dataset in dataset_registry table
   */
  private async registerDataset(
    basinId: string | null,
    datasetType: string,
    r2Path: string,
    etag?: string
  ) {
    try {
      const now = new Date();
      await db
        .insert(datasetRegistry)
        .values({
          basinId,
          datasetType,
          r2Path,
          schemaVersion: this.schemaVersion,
          datasetVersion: now.toISOString(),
          etag: etag || null,
          status: "published",
          generatedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: datasetRegistry.r2Path,
          set: {
            datasetVersion: now.toISOString(),
            etag: etag || null,
            status: "published",
            generatedAt: now,
            updatedAt: now,
          },
        });
    } catch (err) {
      console.warn(`⚠️ Failed to record dataset registry for ${r2Path}:`, err);
    }
  }

  /**
   * 4.1 Publish `/basins.json` (หน้ารวมลุ่มน้ำทั้งประเทศ)
   */
  async publishBasinsList(): Promise<{ success: boolean; url: string }> {
    const allBasins = await db.select().from(basins);
    const allStations = await db.select().from(stations);
    const allTele = await db.select().from(telemetryLatest);

    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const basinsData = allBasins.map((b) => {
      const bStations = allStations.filter((s) => s.basinId === b.id);
      let overallStatus: SituationStatus = "normal";

      for (const st of bStations) {
        const t = teleMap.get(st.id);
        const status = (t?.situationStatus as SituationStatus) || "normal";
        if (status === "critical") {
          overallStatus = "critical";
          break;
        }
        if (status === "warning") {
          overallStatus = "warning";
        } else if (status === "watch" && overallStatus === "normal") {
          overallStatus = "watch";
        }
      }

      return {
        id: b.id,
        slug: b.slug,
        code: b.code,
        name: { th: b.nameTh, en: b.nameEn },
        totalStations: bStations.length,
        overallStatus,
        lastUpdated: this.getNowIso(),
        areaKm2: b.areaKm2 || undefined,
      };
    });

    const payload: BasinsListDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      generatedAt: this.getNowIso(),
      totalBasins: basinsData.length,
      basins: basinsData,
    };

    const path = "basins.json";
    const res = await r2Storage.putJson(path, payload, "public, max-age=600, s-maxage=600");
    await this.registerDataset(null, "basins", path, res.etag);
    return res;
  }

  /**
   * 4.2 & 4.3 Publish `/basin/{slug}/basin.json` & `/basin/{slug}/overview.json`
   */
  async publishBasinOverview(basinSlug: string): Promise<void> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) return;

    const bStations = await db.select().from(stations).where(eq(stations.basinId, b.id));
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    // 1. Publish /basin/{slug}/basin.json
    const basinJson = {
      schemaVersion: this.schemaVersion,
      id: b.id,
      slug: b.slug,
      code: b.code,
      name: { th: b.nameTh, en: b.nameEn },
      description: { th: b.descriptionTh || "", en: b.descriptionEn || "" },
      areaKm2: b.areaKm2,
      boundaryBBox: b.boundaryBBox,
      updatedAt: this.getNowIso(),
    };
    const basinPath = `basin/${b.slug}/basin.json`;
    const bRes = await r2Storage.putJson(basinPath, basinJson, "public, max-age=3600, s-maxage=3600");
    await this.registerDataset(b.id, "basin", basinPath, bRes.etag);

    // 2. Publish /basin/{slug}/overview.json
    let normalCount = 0;
    let watchCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let missingCount = 0;
    let risingCount = 0;
    let heavyRainCount = 0;

    const criticalList: any[] = [];
    const warningList: any[] = [];
    const watchList: any[] = [];

    for (const st of bStations) {
      const t = teleMap.get(st.id);
      const status = (t?.situationStatus as SituationStatus) || "normal";

      if (status === "critical") {
        criticalCount++;
        criticalList.push({ id: st.id, name: { th: st.nameTh, en: st.nameEn }, stage: t?.stage });
      } else if (status === "warning") {
        warningCount++;
        warningList.push({ id: st.id, name: { th: st.nameTh, en: st.nameEn }, stage: t?.stage });
      } else if (status === "watch") {
        watchCount++;
        watchList.push({ id: st.id, name: { th: st.nameTh, en: st.nameEn }, stage: t?.stage });
      } else if (status === "missing") {
        missingCount++;
      } else {
        normalCount++;
      }

      if (t?.trend === "rising") risingCount++;
      if (t?.rainfall24h && t.rainfall24h >= 35) heavyRainCount++;
    }

    const overallStatus: SituationStatus =
      criticalCount > 0
        ? "critical"
        : warningCount > 0
        ? "warning"
        : watchCount > 0
        ? "watch"
        : "normal";

    const statusSummary: BasinStatusSummary = {
      normalCount,
      watchCount,
      warningCount,
      criticalCount,
      missingCount,
      risingCount,
      heavyRainCount,
    };

    const overviewPayload: BasinOverviewDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      basin: b.slug,
      generatedAt: this.getNowIso(),
      summary: {
        totalStations: bStations.length,
        waterLevelStations: bStations.filter((s) => s.type === "water_level").length,
        rainfallStations: bStations.filter((s) => s.type === "rainfall").length,
        overallStatus,
        statusSummary,
      },
      keyStations: {
        critical: criticalList,
        warning: warningList,
        watch: watchList,
      },
      rainfallHighlights: [],
      riverHighlights: [],
    };

    const overviewPath = `basin/${b.slug}/overview.json`;
    const oRes = await r2Storage.putJson(overviewPath, overviewPayload, "public, max-age=120, s-maxage=120");
    await this.registerDataset(b.id, "overview", overviewPath, oRes.etag);
  }

  /**
   * 4.4 Publish `/basin/{slug}/stations.json` (สารบัญสถานีทั้งหมด + Telemetry Snapshot สำหรับ Map)
   */
  async publishBasinStationsList(basinSlug: string): Promise<void> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) return;

    const bStations = await db.select().from(stations).where(eq(stations.basinId, b.id));
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const stationItems: StationSnapshotItem[] = bStations.map((st) => {
      const t = teleMap.get(st.id);
      return {
        id: st.id,
        code: st.code || st.id,
        type: st.type as any,
        name: { th: st.nameTh, en: st.nameEn },
        agency: { th: st.agencyNameTh || "", en: st.agencyNameEn || "" },
        river: st.riverNameTh ? { th: st.riverNameTh, en: st.riverNameEn || "" } : undefined,
        lat: st.lat,
        lon: st.lon,
        current: t
          ? {
              stage: t.stage,
              discharge: t.discharge,
              rainfall1h: t.rainfall1h,
              rainfall3h: t.rainfall3h,
              rainfall6h: t.rainfall6h,
              rainfall24h: t.rainfall24h,
              rainfallToday: t.rainfallToday,
              waterLevelMsl: t.waterLevelMsl,
              storagePercent: t.storagePercent,
              trend: (t.trend as any) || "steady",
              status: (t.situationStatus as any) || "normal",
              freshness: (t.freshnessStatus as any) || "fresh",
              alertReason: t.alertReasonTh ? { th: t.alertReasonTh, en: t.alertReasonEn || "" } : undefined,
              isUpstreamAlert: t.isUpstreamAlert === "true",
              lastUpdated: t.timestamp?.toISOString() || this.getNowIso(),
            }
          : {
              status: "normal",
              freshness: "fresh",
              lastUpdated: this.getNowIso(),
            },
      };
    });

    const payload: StationListDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      basin: b.slug,
      generatedAt: this.getNowIso(),
      totalStations: stationItems.length,
      stations: stationItems,
    };

    const path = `basin/${b.slug}/stations.json`;
    const res = await r2Storage.putJson(path, payload, "public, max-age=180, s-maxage=180");
    await this.registerDataset(b.id, "stations", path, res.etag);
  }

  /**
   * 4.5, 4.6, 4.7, 4.8 Publish individual station datasets (`detail.json`, `current.json`, `history/{date}.json`, `relations.json`)
   */
  async publishStationDatasets(stationId: string): Promise<void> {
    const [st] = await db.select().from(stations).where(eq(stations.id, stationId));
    if (!st) return;

    const [b] = await db.select().from(basins).where(eq(basins.id, st.basinId));
    const basinSlug = b ? b.slug : st.basinId;

    const [t] = await db.select().from(telemetryLatest).where(eq(telemetryLatest.stationId, st.id));

    // 1. detail.json
    const detailPayload: StationDetailDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      generatedAt: this.getNowIso(),
      station: {
        id: st.id,
        code: st.code || st.id,
        basin: basinSlug,
        type: st.type as any,
        name: { th: st.nameTh, en: st.nameEn },
        address: { th: st.addressTh || "", en: st.addressEn || "" },
        agency: { th: st.agencyNameTh || "", en: st.agencyNameEn || "" },
        river: st.riverNameTh ? { th: st.riverNameTh, en: st.riverNameEn || "" } : undefined,
        location: {
          lat: st.lat,
          lon: st.lon,
          groundLevelMsl: st.groundLevelMsl,
          bankLevelMsl: st.bankLevelMsl,
          warningLevelMsl: st.warningLevelMsl,
          criticalLevelMsl: st.criticalLevelMsl,
        },
        thresholds: {
          bankLevelMsl: st.bankLevelMsl,
          warningLevelMsl: st.warningLevelMsl,
          criticalLevelMsl: st.criticalLevelMsl,
          warningRain24h: st.warningRain24h,
          criticalRain24h: st.criticalRain24h,
        },
        source: {
          provider: st.source || "thaiwater",
          sourceStationId: st.sourceStationId || st.id,
        },
        status: (st.status as any) || "active",
      },
    };
    const detailPath = `basin/${basinSlug}/stations/${st.id}/detail.json`;
    const dRes = await r2Storage.putJson(detailPath, detailPayload, "public, max-age=86400, s-maxage=86400");
    await this.registerDataset(st.basinId, "station_detail", detailPath, dRes.etag);

    // 2. current.json
    const currentPayload: StationCurrentDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      stationId: st.id,
      basin: basinSlug,
      type: st.type as any,
      timestamp: t?.timestamp?.toISOString() || this.getNowIso(),
      status: (t?.situationStatus as any) || "normal",
      freshness: (t?.freshnessStatus as any) || "fresh",
      alertReason: t?.alertReasonTh ? { th: t.alertReasonTh, en: t.alertReasonEn || "" } : undefined,
      isUpstreamAlert: t?.isUpstreamAlert === "true",
      waterLevel:
        st.type === "water_level"
          ? {
              stage: t?.stage || null,
              discharge: t?.discharge || null,
              waterLevelMsl: t?.waterLevelMsl || null,
              storagePercent: t?.storagePercent || null,
              trend: (t?.trend as any) || "steady",
            }
          : undefined,
      rainfall:
        st.type === "rainfall"
          ? {
              value1h: t?.rainfall1h || null,
              value3h: t?.rainfall3h || null,
              value6h: t?.rainfall6h || null,
              value24h: t?.rainfall24h || null,
              valueToday: t?.rainfallToday || null,
              intensity: t?.rainfall24h ? (t.rainfall24h > 35 ? "heavy" : "moderate") : "light",
            }
          : undefined,
      updatedAt: this.getNowIso(),
    };
    const currentPath = `basin/${basinSlug}/stations/${st.id}/current.json`;
    const cRes = await r2Storage.putJson(currentPath, currentPayload, "public, max-age=60, s-maxage=60");
    await this.registerDataset(st.basinId, "current", currentPath, cRes.etag);

    // 3. history/{date}.json (Today's snapshot)
    const today = this.getTodayDateString();
    const historyPath = `basin/${basinSlug}/stations/${st.id}/history/${today}.json`;
    const historyPayload = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      stationId: st.id,
      basin: basinSlug,
      type: st.type,
      date: today,
      generatedAt: this.getNowIso(),
      observations: [
        {
          timestamp: t?.timestamp?.toISOString() || this.getNowIso(),
          stage: t?.stage || null,
          discharge: t?.discharge || null,
          value: t?.rainfall1h || null,
          status: "valid",
        },
      ],
    };
    const hRes = await r2Storage.putJson(historyPath, historyPayload, "public, max-age=600, s-maxage=600");
    await this.registerDataset(st.basinId, "history", historyPath, hRes.etag);

    // 4. relations.json
    const relPath = `basin/${basinSlug}/stations/${st.id}/relations.json`;
    const { stationRelations } = await import("../db/schema");
    const dbRelations = await db
      .select()
      .from(stationRelations)
      .where(eq(stationRelations.stationId, st.id));

    const relationItems: StationRelationItem[] = [];

    for (const rel of dbRelations) {
      const [targetStation] = await db.select().from(stations).where(eq(stations.id, rel.targetStationId));
      if (!targetStation) continue;
      const [targetTele] = await db
        .select()
        .from(telemetryLatest)
        .where(eq(telemetryLatest.stationId, targetStation.id));

      const isTargetWater = targetStation.type === "water_level";
      let latestValue = "-";
      if (targetTele) {
        latestValue = isTargetWater
          ? `${(targetTele.stage || targetTele.waterLevelMsl || 0).toFixed(2)} ม.รทก.`
          : `${(targetTele.rainfall24h || 0).toFixed(1)} มม.`;
      }

      relationItems.push({
        type: rel.relationType as any,
        stationId: rel.targetStationId,
        targetStationId: rel.targetStationId,
        name: { th: targetStation.nameTh, en: targetStation.nameEn },
        targetStationName: { th: targetStation.nameTh, en: targetStation.nameEn },
        stationType: targetStation.type as any,
        distanceKm: rel.distanceKm || 0,
        travelTimeHours: rel.travelTimeHours || null,
        influenceWeightPercent: rel.influenceWeightPercent || null,
        latestValue,
        status: (targetTele?.situationStatus as any) || "normal",
        isUpstream: rel.isUpstream,
      });
    }

    const relPayload: StationRelationsDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      stationId: st.id,
      basin: basinSlug,
      generatedAt: this.getNowIso(),
      relations: relationItems,
    };
    const rRes = await r2Storage.putJson(relPath, relPayload, "public, max-age=180, s-maxage=180");
    await this.registerDataset(st.basinId, "relations", relPath, rRes.etag);
  }

  /**
   * 4.9 - 4.11 & 5. Spatial layers and reports (`river/chain.json`, `events/feed.json`, `spatial/*.geojson`)
   */
  async publishSpatialAndReports(basinSlug: string): Promise<void> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) return;

    const bStations = await db.select().from(stations).where(eq(stations.basinId, b.id));
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    // 1. river/chain.json
    const chainPath = `basin/${b.slug}/river/chain.json`;
    const chainPayload = {
      schemaVersion: this.schemaVersion,
      basin: b.slug,
      river: b.slug,
      generatedAt: this.getNowIso(),
      stations: ["8892", "Y-0020"],
    };
    await r2Storage.putJson(chainPath, chainPayload, "public, max-age=86400, s-maxage=86400");

    // 2. events/feed.json
    const alertEvents: any[] = [];
    let eventIndex = 1;

    for (const st of bStations) {
      const t = teleMap.get(st.id);
      if (!t) continue;

      if (t.isUpstreamAlert === "true" && t.alertReasonTh) {
        alertEvents.push({
          id: `EV-${b.slug}-${String(eventIndex++).padStart(3, "0")}`,
          timestamp: t.timestamp?.toISOString() || this.getNowIso(),
          level: "warning",
          title: `แจ้งเตือนฝนตกหนักต้นน้ำ (${st.nameTh})`,
          message: t.alertReasonTh,
          stationId: st.id,
        });
      } else if (t.situationStatus === "critical" || t.situationStatus === "warning") {
        alertEvents.push({
          id: `EV-${b.slug}-${String(eventIndex++).padStart(3, "0")}`,
          timestamp: t.timestamp?.toISOString() || this.getNowIso(),
          level: t.situationStatus,
          title: `แจ้งเตือนสถานการณ์น้ำ (${st.nameTh})`,
          message: t.alertReasonTh || `สถานี ${st.nameTh} อยู่ในเกณฑ์${t.situationStatus === "critical" ? "วิกฤต" : "เตือนภัย"}`,
          stationId: st.id,
        });
      }
    }

    if (alertEvents.length === 0) {
      alertEvents.push({
        id: `EV-${b.slug}-001`,
        timestamp: this.getNowIso(),
        level: "info",
        title: `สถานการณ์น้ำ${b.nameTh}ประจำวัน`,
        message: "ปริมาณน้ำและการไหลของลำน้ำอยู่ในเกณฑ์ปกติ ติดตามเฝ้าระวังต่อเนื่อง",
      });
    }

    const feedPath = `basin/${b.slug}/events/feed.json`;
    const feedPayload = {
      schemaVersion: this.schemaVersion,
      basin: b.slug,
      generatedAt: this.getNowIso(),
      events: alertEvents,
    };
    await r2Storage.putJson(feedPath, feedPayload, "public, max-age=600, s-maxage=600");

    // 3. /basin/{basin}/report/bulletin-latest.json (LLM / Hydrological Bulletin Synthesis)
    await llmBulletinService.generateBulletin(b.slug);

    // 4. spatial/boundary.geojson
    const boundaryPath = `basin/${b.slug}/spatial/boundary.geojson`;
    const bbox = (b.boundaryBBox as number[]) || [99.45, 16.45, 100.42, 19.12];
    const boundaryGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            basinId: b.slug,
            nameTh: b.nameTh,
            nameEn: b.nameEn,
            areaKm2: b.areaKm2,
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [bbox[0], bbox[3]],
                [bbox[2], bbox[3]],
                [bbox[2], bbox[1]],
                [bbox[0], bbox[1]],
                [bbox[0], bbox[3]],
              ],
            ],
          },
        },
      ],
    };
    await r2Storage.putJson(boundaryPath, boundaryGeoJson, "public, max-age=604800, s-maxage=604800");

    // 4. spatial/rivers.geojson
    const riversPath = `basin/${b.slug}/spatial/rivers.geojson`;
    const riversGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            riverId: `R-${b.slug.toUpperCase()}-01`,
            nameTh: `แม่น้ำ${b.nameTh.replace("ลุ่มน้ำ", "")} (สายหลัก)`,
            nameEn: `${b.nameEn} Main Stream`,
            order: 1,
            lengthKm: 735.0,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [bbox[0] + 0.4, bbox[3] - 0.1],
              [bbox[0] + 0.3, bbox[3] - 0.6],
              [bbox[0] + 0.25, bbox[1] + 0.8],
              [bbox[2] - 0.3, bbox[1] + 0.2],
            ],
          },
        },
      ],
    };
    await r2Storage.putJson(riversPath, riversGeoJson, "public, max-age=604800, s-maxage=604800");
  }

  /**
   * Full rebuild and publish of ALL public R2 datasets for all basins
   */
  async rebuildAllDatasets(targetBasinSlug?: string): Promise<{
    success: boolean;
    basinsCount: number;
    stationsCount: number;
  }> {
    console.log("🚀 Starting Full R2 Public Datasets Rebuild...");

    // 1. Publish root /basins.json
    await this.publishBasinsList();

    const allBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins);

    let stationsCount = 0;

    for (const b of allBasins) {
      // 2. Publish Basin overview & stations list
      await this.publishBasinOverview(b.slug);
      await this.publishBasinStationsList(b.slug);
      await this.publishSpatialAndReports(b.slug);

      // 3. Publish individual stations
      const bStations = await db.select().from(stations).where(eq(stations.basinId, b.id));
      stationsCount += bStations.length;

      for (const st of bStations) {
        await this.publishStationDatasets(st.id);
      }
    }

    console.log(`✅ Successfully published datasets for ${allBasins.length} basins and ${stationsCount} stations`);
    return {
      success: true,
      basinsCount: allBasins.length,
      stationsCount,
    };
  }
}

export const r2Publisher = new R2PublisherService();
