import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { basins, datasetRegistry, rainfallStations, stationRelations, telemetryLatest, waterlevelStations } from "../db/schema";
import { getModelDatasetDir } from "../config/paths";
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
import { formatBangkokDate } from "../utils/date";
import { llmBulletinService } from "./llmBulletinService";
import { r2Storage } from "./r2StorageService";

export class R2PublisherService {
  private schemaVersion = "1.0";

  private getNowIso(): string {
    return new Date().toISOString();
  }

  private getTodayDateString(): string {
    return formatBangkokDate();
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
   * Helper to retrieve all stations for a basin (from both waterlevel and rainfall tables)
   */
  public async getStationsForBasin(basinId?: string) {
    const wl = basinId
      ? await db.select().from(waterlevelStations).where(eq(waterlevelStations.basinId, basinId))
      : await db.select().from(waterlevelStations);

    const rf = basinId
      ? await db.select().from(rainfallStations).where(eq(rainfallStations.basinId, basinId))
      : await db.select().from(rainfallStations);

    return {
      waterlevel: wl,
      rainfall: rf,
      all: [
        ...wl.map((s) => ({ ...s, type: "water_level" as const })),
        ...rf.map((s) => ({ ...s, type: "rainfall" as const })),
      ],
    };
  }

  /**
   * 4.1 Publish `/basins.json` (หน้ารวมลุ่มน้ำทั้งประเทศ - เฉพาะ is_active = true)
   */
  async publishBasinsList(): Promise<{ success: boolean; url: string }> {
    const activeBasins = await db.select().from(basins).where(eq(basins.isActive, true));
    const { all: allStations } = await this.getStationsForBasin();
    const allTele = await db.select().from(telemetryLatest);

    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const basinsData = activeBasins.map((b) => {
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

    const { all: bStations, waterlevel: wlStations, rainfall: rfStations } = await this.getStationsForBasin(b.id);
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
      boundaryGeojsonPath: b.boundaryGeojsonPath,
      flowPathsGeojsonPath: b.flowPathsGeojsonPath,
      isActive: b.isActive,
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
        waterLevelStations: wlStations.length,
        rainfallStations: rfStations.length,
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

    const { all: bStations } = await this.getStationsForBasin(b.id);
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const stationItems: StationSnapshotItem[] = bStations.map((st) => {
      const t = teleMap.get(st.id);
      const isWL = st.type === "water_level";
      const wlSpecific = isWL ? (st as typeof waterlevelStations.$inferSelect) : null;

      return {
        id: st.id,
        code: st.oldcode || st.id,
        type: st.type as any,
        name: { th: st.nameTh, en: st.nameEn },
        agency: { th: st.agencyNameTh || "", en: st.agencyNameEn || "" },
        river: wlSpecific?.riverName ? { th: wlSpecific.riverName, en: wlSpecific.riverName } : undefined,
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
              lastUpdated: t.timestamp?.toISOString() || "",
            }
          : {
              status: "missing",
              freshness: "missing",
              lastUpdated: "",
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

    // 1. Publish separated lists: waterlevel_station/{basin}/stations.json & rainfall_station/{basin}/stations.json
    const wlStationsList = stationItems.filter((s) => s.type === "water_level");
    const rfStationsList = stationItems.filter((s) => s.type === "rainfall");

    const wlListPath = `waterlevel_station/${b.slug}/stations.json`;
    await r2Storage.putJson(wlListPath, { ...payload, totalStations: wlStationsList.length, stations: wlStationsList }, "public, max-age=180, s-maxage=180");
    await this.registerDataset(b.id, "stations_waterlevel", wlListPath);

    const rfListPath = `rainfall_station/${b.slug}/stations.json`;
    await r2Storage.putJson(rfListPath, { ...payload, totalStations: rfStationsList.length, stations: rfStationsList }, "public, max-age=180, s-maxage=180");
    await this.registerDataset(b.id, "stations_rainfall", rfListPath);
  }

  /**
   * 4.5, 4.6, 4.7, 4.8 Publish individual station datasets (`detail.json`, `current.json`, `relations.json`)
   * Stored under waterlevel_station/{basin}/{id}/ and rainfall_station/{basin}/{id}/
   */
  async publishStationDatasets(stationId: string, preloadedTeleMap?: Map<string, any>): Promise<void> {
    const [wl] = await db.select().from(waterlevelStations).where(eq(waterlevelStations.id, stationId));
    const [rf] = !wl ? await db.select().from(rainfallStations).where(eq(rainfallStations.id, stationId)) : [undefined];
    const st = wl || rf;
    if (!st) return;

    const isWL = !!wl;
    const [b] = await db.select().from(basins).where(eq(basins.id, st.basinId));
    const basinSlug = b ? b.slug : st.basinId;
    const [t] = await db.select().from(telemetryLatest).where(eq(telemetryLatest.stationId, st.id));

    const folderPrefix = isWL
      ? `waterlevel_station/${basinSlug}/${st.id}`
      : `rainfall_station/${basinSlug}/${st.id}`;

    // Extract relations from rawMetadata
    const metaRelations = (st.rawMetadata as Record<string, any>)?.relations || {};
    const influencingRainRaw = isWL ? (metaRelations.influencingRainfallStations || []) : [];
    const streamFallRaw = isWL ? (metaRelations.streamFall || metaRelations.downstreamStations || []) : [];
    const receivingWlRaw = !isWL ? (metaRelations.receivingWaterlevelStations || []) : [];

    // Pre-fetch all telemetries for quick enrichment if not already supplied
    const teleMap =
      preloadedTeleMap ||
      new Map((await db.select().from(telemetryLatest)).map((t) => [t.stationId, t]));

    // Enrich influencing rainfall stations
    const enrichedInfluencing = influencingRainRaw.map((inf: any) => {
      const t = teleMap.get(inf.stationId);
      return {
        ...inf,
        latestRain24h: t?.rainfall24h ?? null,
        status: (t?.situationStatus as any) || "normal",
      };
    });

    // Enrich streamFall stations
    const enrichedStreamFall = streamFallRaw.map((ds: any) => {
      const t = teleMap.get(ds.stationId);
      return {
        ...ds,
        latestStage: t?.stage ?? t?.waterLevelMsl ?? null,
        status: (t?.situationStatus as any) || "normal",
      };
    });

    // Enrich receivingWaterlevelStations
    const enrichedReceiving = receivingWlRaw.map((rec: any) => {
      const t = teleMap.get(rec.stationId);
      return {
        ...rec,
        latestStage: t?.stage ?? t?.waterLevelMsl ?? null,
        status: (t?.situationStatus as any) || "normal",
      };
    });

    // 1. detail.json
    const detailPayload: StationDetailDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      generatedAt: this.getNowIso(),
      station: {
        id: st.id,
        code: st.oldcode || st.id,
        basin: basinSlug,
        type: isWL ? "water_level" : "rainfall",
        name: { th: st.nameTh, en: st.nameEn },
        address: {
          th: `${st.tumbonNameTh || ""} ${st.amphoeNameTh || ""} ${st.provinceNameTh || ""}`.trim(),
          en: `${st.tumbonNameEn || ""} ${st.amphoeNameEn || ""} ${st.provinceNameEn || ""}`.trim(),
        },
        agency: { th: st.agencyNameTh || "", en: st.agencyNameEn || "" },
        river: isWL && (st as typeof waterlevelStations.$inferSelect).riverName
          ? { th: (st as typeof waterlevelStations.$inferSelect).riverName!, en: (st as typeof waterlevelStations.$inferSelect).riverName! }
          : undefined,
        location: (() => {
          const gMsl = isWL ? (st as typeof waterlevelStations.$inferSelect).groundLevel : null;
          const bMsl = isWL ? (st as typeof waterlevelStations.$inferSelect).minBank : null;
          let wMsl: number | null = null;
          if (bMsl != null) {
            if (gMsl != null && bMsl > gMsl) {
              wMsl = Number((gMsl + (bMsl - gMsl) * 0.85).toFixed(2));
            } else {
              wMsl = Number(Math.max(0, bMsl - 0.8).toFixed(2));
            }
          }
          return {
            lat: st.lat,
            lon: st.lon,
            groundLevelMsl: gMsl,
            bankLevelMsl: bMsl,
            warningLevelMsl: wMsl,
            criticalLevelMsl: bMsl,
          };
        })(),
        thresholds: (() => {
          const gMsl = wl ? wl.groundLevel : null;
          const bMsl = wl ? wl.minBank : null;
          let wMsl: number | null = null;
          if (bMsl != null) {
            if (gMsl != null && bMsl > gMsl) {
              wMsl = Number((gMsl + (bMsl - gMsl) * 0.85).toFixed(2));
            } else {
              wMsl = Number(Math.max(0, bMsl - 0.8).toFixed(2));
            }
          }
          return {
            groundLevelMsl: gMsl,
            bedLevelMsl: gMsl,
            bankLevelMsl: bMsl,
            warningLevelMsl: wMsl,
            criticalLevelMsl: bMsl,
            warningRain24h: rf ? rf.warningRain24h : null,
            criticalRain24h: rf ? rf.criticalRain24h : null,
          };
        })(),
        relationsSummary: isWL
          ? {
              influencingRainfallCount: influencingRainRaw.length,
              streamFallCount: streamFallRaw.length,
              nextStationId: streamFallRaw[0]?.stationId || null,
              streamFallName: streamFallRaw[0]?.stationName || null,
            }
          : {
              receivingWaterlevelCount: receivingWlRaw.length,
              receivingStationIds: receivingWlRaw.map((r: any) => r.stationId),
            },
        source: {
          provider: "thaiwater",
          sourceStationId: st.id,
        },
        status: (st.status as any) || "active",
      },
    };
    const detailPath = `${folderPrefix}/detail.json`;
    const dRes = await r2Storage.putJson(detailPath, detailPayload, "public, max-age=86400, s-maxage=86400");
    await this.registerDataset(st.basinId, isWL ? "waterlevel_detail" : "rainfall_detail", detailPath, dRes.etag);

    // 2. relations.json
    const relPath = `${folderPrefix}/relations.json`;
    const dbRelations = await db
      .select()
      .from(stationRelations)
      .where(or(eq(stationRelations.stationId, st.id), eq(stationRelations.targetStationId, st.id)));

    const relationItems: StationRelationItem[] = [];

    for (const rel of dbRelations) {
      const isTarget = rel.stationId === st.id;
      const otherId = isTarget ? rel.targetStationId : rel.stationId;

      const [otherWL] = await db.select().from(waterlevelStations).where(eq(waterlevelStations.id, otherId));
      const [otherRF] = !otherWL ? await db.select().from(rainfallStations).where(eq(rainfallStations.id, otherId)) : [undefined];
      const otherSt = otherWL || otherRF;
      if (!otherSt) continue;

      const targetTele = teleMap.get(otherId);

      const isTargetWater = !!otherWL;
      let latestValue = "-";
      if (targetTele) {
        latestValue = isTargetWater
          ? `${(targetTele.stage || targetTele.waterLevelMsl || 0).toFixed(2)} ม.รทก.`
          : `${(targetTele.rainfall24h || 0).toFixed(1)} มม.`;
      }

      relationItems.push({
        type: rel.relationType as any,
        stationId: otherId,
        targetStationId: otherId,
        name: { th: otherSt.nameTh, en: otherSt.nameEn },
        targetStationName: { th: otherSt.nameTh, en: otherSt.nameEn },
        stationType: isTargetWater ? "water_level" : "rainfall",
        distanceKm: rel.distanceKm || 0,
        travelTimeHours: rel.travelTimeHours || null,
        influenceWeightPercent: null,
        latestValue,
        status: (targetTele?.situationStatus as any) || "normal",
        isUpstream: rel.relationType === "influencing" || !isTarget,
      });
    }

    const relPayload: StationRelationsDataset = {
      schemaVersion: this.schemaVersion,
      datasetVersion: this.getNowIso(),
      stationId: st.id,
      stationType: isWL ? "water_level" : "rainfall",
      basin: basinSlug,
      generatedAt: this.getNowIso(),
      influencingRainfallStations: isWL ? enrichedInfluencing : undefined,
      streamFall: isWL ? enrichedStreamFall : undefined,
      downstreamStations: isWL ? enrichedStreamFall : undefined,
      receivingWaterlevelStations: !isWL ? enrichedReceiving : undefined,
      relations: relationItems,
    };
    const rRes = await r2Storage.putJson(relPath, relPayload, "public, max-age=180, s-maxage=180");
    await this.registerDataset(st.basinId, "relations", relPath, rRes.etag);
  }

  /**
   * 4.9 - 4.11 Spatial layers and reports (`river/chain.json`, `events/feed.json`, `spatial/*.geojson`)
   */
  async publishSpatialAndReports(basinSlug: string): Promise<void> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) return;

    const { all: bStations } = await this.getStationsForBasin(b.id);
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    // 1. river/chain.json
    const chainPath = `basin/${b.slug}/river/chain.json`;
    const chainPayload = {
      schemaVersion: this.schemaVersion,
      basin: b.slug,
      river: b.slug,
      generatedAt: this.getNowIso(),
      stations: bStations.filter((s) => s.type === "water_level").slice(0, 10).map((s) => s.id),
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

    // 3. /basin/{basin}/report/bulletin-latest.json
    try {
      await llmBulletinService.generateBulletin(b.slug);
    } catch (err) {
      // LLM bulletin generation is optional
    }

    // 4. spatial/boundary.geojson
    try {
      await this.publishBasinBoundary(b.slug);
    } catch (err: any) {
      console.warn(`⚠️ Warning auto-publishing boundary for ${b.slug}:`, err.message);
    }

    // 5. spatial/rivers.geojson
    const riversPath = `basin/${b.slug}/spatial/rivers.geojson`;
    const modelDir = getModelDatasetDir();
    let realRiverFile: string | null = null;
    if (modelDir) {
      const p1 = join(modelDir, b.slug, "processed", "river_network_main.geojson");
      const p2 = join(modelDir, b.slug, "gis", "osm_waterways.geojson");
      realRiverFile = existsSync(p1) ? p1 : existsSync(p2) ? p2 : null;
    }

    let riversGeoJson: any = null;
    if (realRiverFile) {
      try {
        riversGeoJson = JSON.parse(readFileSync(realRiverFile, "utf-8"));
      } catch {
        riversGeoJson = null;
      }
    }

    if (riversGeoJson) {
      await r2Storage.putJson(riversPath, riversGeoJson, "public, max-age=604800, s-maxage=604800");
    }
  }

  /**
   * Helper to locate model GIS boundary file for a basin slug
   */
  public getModelBoundaryPath(slug: string): string | null {
    const modelDir = getModelDatasetDir();
    if (!modelDir) return null;

    const basinGisDir = join(modelDir, slug, "gis");
    const exactFile = join(basinGisDir, `${slug}_boundary.geojson`);
    if (existsSync(exactFile)) return exactFile;

    if (existsSync(basinGisDir)) {
      try {
        const files = readdirSync(basinGisDir);
        const candidate = files.find((f) => f.endsWith("_boundary.geojson") || f === "boundary.geojson");
        if (candidate) return join(basinGisDir, candidate);
      } catch {
        // ignore
      }
    }

    return null;
  }

  /**
   * Publish boundary GeoJSON for a basin (uploads to R2, updates DB, registers dataset)
   */
  async publishBasinBoundary(
    basinSlug: string,
    geoJsonOverride?: any
  ): Promise<{ success: boolean; r2Path: string; etag?: string; source: string }> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) {
      throw new Error(`Basin with slug '${basinSlug}' not found in database`);
    }

    let boundaryGeoJson = geoJsonOverride;
    let source = "override";

    if (!boundaryGeoJson) {
      const modelGisBoundary = this.getModelBoundaryPath(b.slug);
      if (modelGisBoundary && existsSync(modelGisBoundary)) {
        try {
          boundaryGeoJson = JSON.parse(readFileSync(modelGisBoundary, "utf-8"));
          source = `model:${modelGisBoundary}`;
        } catch (err: any) {
          console.warn(`⚠️ Failed to parse boundary file for ${b.slug} at ${modelGisBoundary}:`, err.message);
        }
      }
    }

    if (!boundaryGeoJson) {
      throw new Error(`No boundary GeoJSON found for basin '${b.slug}'`);
    }

    const r2Key = `basin/${b.slug}/spatial/boundary.geojson`;
    const putRes = await r2Storage.putJson(r2Key, boundaryGeoJson, "public, max-age=604800, s-maxage=604800");

    // Update database basins record
    await db
      .update(basins)
      .set({
        boundaryGeojsonPath: r2Key,
        updatedAt: new Date(),
      })
      .where(eq(basins.id, b.id));

    // Register in dataset_registry
    await this.registerDataset(b.id, "spatial_boundary", r2Key, putRes.etag);

    return {
      success: true,
      r2Path: r2Key,
      etag: putRes.etag,
      source,
    };
  }

  /**
   * Auto publish boundaries for all active basins (or target basin)
   */
  async publishAllBasinBoundaries(targetBasinSlug?: string): Promise<{
    success: boolean;
    total: number;
    uploaded: number;
    failed: number;
    results: Array<{ slug: string; success: boolean; r2Path?: string; error?: string }>;
  }> {
    const allBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins);

    const results: Array<{ slug: string; success: boolean; r2Path?: string; error?: string }> = [];
    let uploaded = 0;
    let failed = 0;

    for (const b of allBasins) {
      try {
        const res = await this.publishBasinBoundary(b.slug);
        results.push({ slug: b.slug, success: true, r2Path: res.r2Path });
        uploaded++;
      } catch (err: any) {
        results.push({ slug: b.slug, success: false, error: err.message });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total: allBasins.length,
      uploaded,
      failed,
      results,
    };
  }

  /**
   * Helper to locate model processed flow_paths file for a basin slug (.geojson.gz or .geojson)
   */
  public getModelFlowPathsPath(slug: string): { path: string; isGzip: boolean } | null {
    const modelDir = getModelDatasetDir();
    if (!modelDir) return null;

    const basinProcessedDir = join(modelDir, slug, "processed");
    const gzFile = join(basinProcessedDir, "flow_paths.geojson.gz");
    if (existsSync(gzFile)) return { path: gzFile, isGzip: true };

    const jsonFile = join(basinProcessedDir, "flow_paths.geojson");
    if (existsSync(jsonFile)) return { path: jsonFile, isGzip: false };

    if (existsSync(basinProcessedDir)) {
      try {
        const files = readdirSync(basinProcessedDir);
        const gzCandidate = files.find((f) => f.includes("flow_paths") && f.endsWith(".geojson.gz"));
        if (gzCandidate) return { path: join(basinProcessedDir, gzCandidate), isGzip: true };
        const jsonCandidate = files.find((f) => f.includes("flow_paths") && f.endsWith(".geojson"));
        if (jsonCandidate) return { path: join(basinProcessedDir, jsonCandidate), isGzip: false };
      } catch {
        // ignore
      }
    }

    return null;
  }

  /**
   * Publish flow paths GeoJSON (.gz) for a basin (uploads to R2, updates DB, registers dataset)
   */
  async publishBasinFlowPaths(
    basinSlug: string,
    bufferOverride?: Buffer,
    isOverrideGzipped: boolean = true
  ): Promise<{ success: boolean; r2Path: string; etag?: string; source: string; featuresCount: number }> {
    const [b] = await db.select().from(basins).where(eq(basins.slug, basinSlug));
    if (!b) {
      throw new Error(`Basin with slug '${basinSlug}' not found in database`);
    }

    let gzBuffer: Buffer | null = null;
    let source = "override";
    let featuresCount = 0;

    if (bufferOverride) {
      if (isOverrideGzipped) {
        // Validate by unzipping in memory
        const unzipped = gunzipSync(bufferOverride);
        const parsed = JSON.parse(unzipped.toString("utf-8"));
        if (!parsed || (parsed.type !== "FeatureCollection" && parsed.type !== "Feature")) {
          throw new Error("Invalid GeoJSON format inside gzip archive. Expected FeatureCollection or Feature");
        }
        featuresCount = Array.isArray(parsed.features) ? parsed.features.length : 1;
        gzBuffer = bufferOverride;
      } else {
        const parsed = JSON.parse(bufferOverride.toString("utf-8"));
        if (!parsed || (parsed.type !== "FeatureCollection" && parsed.type !== "Feature")) {
          throw new Error("Invalid GeoJSON format. Expected FeatureCollection or Feature");
        }
        featuresCount = Array.isArray(parsed.features) ? parsed.features.length : 1;
        gzBuffer = gzipSync(bufferOverride);
      }
    } else {
      const modelFile = this.getModelFlowPathsPath(b.slug);
      if (modelFile && existsSync(modelFile.path)) {
        source = `model:${modelFile.path}`;
        const raw = readFileSync(modelFile.path);
        if (modelFile.isGzip) {
          const unzipped = gunzipSync(raw);
          const parsed = JSON.parse(unzipped.toString("utf-8"));
          featuresCount = Array.isArray(parsed.features) ? parsed.features.length : 1;
          gzBuffer = raw;
        } else {
          const parsed = JSON.parse(raw.toString("utf-8"));
          featuresCount = Array.isArray(parsed.features) ? parsed.features.length : 1;
          gzBuffer = gzipSync(raw);
        }
      }
    }

    if (!gzBuffer) {
      throw new Error(`No flow paths GeoJSON found for basin '${b.slug}'`);
    }

    const r2Key = `basin/${b.slug}/spatial/flow_paths.geojson.gz`;
    const putRes = await r2Storage.putBuffer(
      r2Key,
      gzBuffer,
      "application/gzip",
      "public, max-age=604800, s-maxage=604800"
    );

    // Update database basins record
    await db
      .update(basins)
      .set({
        flowPathsGeojsonPath: r2Key,
        updatedAt: new Date(),
      })
      .where(eq(basins.id, b.id));

    // Register in dataset_registry
    await this.registerDataset(b.id, "spatial_flow_paths", r2Key, putRes.etag);

    return {
      success: true,
      r2Path: r2Key,
      etag: putRes.etag,
      source,
      featuresCount,
    };
  }

  /**
   * Auto publish flow paths for all active basins (or target basin)
   */
  async publishAllBasinFlowPaths(targetBasinSlug?: string): Promise<{
    success: boolean;
    total: number;
    uploaded: number;
    failed: number;
    results: Array<{ slug: string; success: boolean; r2Path?: string; featuresCount?: number; error?: string }>;
  }> {
    const allBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins);

    const results: Array<{ slug: string; success: boolean; r2Path?: string; featuresCount?: number; error?: string }> = [];
    let uploaded = 0;
    let failed = 0;

    for (const b of allBasins) {
      try {
        const res = await this.publishBasinFlowPaths(b.slug);
        results.push({ slug: b.slug, success: true, r2Path: res.r2Path, featuresCount: res.featuresCount });
        uploaded++;
      } catch (err: any) {
        results.push({ slug: b.slug, success: false, error: err.message });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total: allBasins.length,
      uploaded,
      failed,
      results,
    };
  }

  /**
   * Full rebuild and publish of ALL public R2 datasets for active basins
   */
  async rebuildAllDatasets(targetBasinSlug?: string): Promise<{
    success: boolean;
    basinsCount: number;
    stationsCount: number;
  }> {
    console.log("🚀 Starting Full R2 Public Datasets Rebuild...");

    // 1. Publish root /basins.json (only active basins)
    await this.publishBasinsList();

    const allBasins = targetBasinSlug
      ? await db.select().from(basins).where(eq(basins.slug, targetBasinSlug))
      : await db.select().from(basins).where(eq(basins.isActive, true));

    let stationsCount = 0;

    const allTele = await db.select().from(telemetryLatest);
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    for (const b of allBasins) {
      // 2. Publish Basin overview & stations list
      await this.publishBasinOverview(b.slug);
      await this.publishBasinStationsList(b.slug);
      await this.publishSpatialAndReports(b.slug);

      // 3. Publish individual stations with controlled concurrency (50 workers)
      const { all: bStations } = await this.getStationsForBasin(b.id);
      stationsCount += bStations.length;

      const CONCURRENCY = 50;
      for (let i = 0; i < bStations.length; i += CONCURRENCY) {
        const batch = bStations.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map((st) =>
            this.publishStationDatasets(st.id, teleMap).catch((err) =>
              console.warn(`⚠️ Warning publishing station ${st.id}:`, err.message)
            )
          )
        );
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
