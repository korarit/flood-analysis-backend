import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { basins, datasetRegistry, rainfallStations, stationRelations, telemetryLatest, waterlevelStations } from "../db/schema";
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
        location: {
          lat: st.lat,
          lon: st.lon,
          groundLevelMsl: isWL ? (st as typeof waterlevelStations.$inferSelect).groundLevel : null,
          bankLevelMsl: isWL ? (st as typeof waterlevelStations.$inferSelect).minBank : null,
          warningLevelMsl: isWL && (st as typeof waterlevelStations.$inferSelect).minBank ? (st as typeof waterlevelStations.$inferSelect).minBank! * 0.85 : null,
          criticalLevelMsl: isWL ? (st as typeof waterlevelStations.$inferSelect).minBank : null,
        },
        thresholds: {
          bankLevelMsl: wl ? wl.minBank : null,
          warningLevelMsl: wl && wl.minBank ? wl.minBank * 0.85 : null,
          criticalLevelMsl: wl ? wl.minBank : null,
          warningRain24h: rf ? rf.warningRain24h : null,
          criticalRain24h: rf ? rf.criticalRain24h : null,
        },
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
    const boundaryPath = `basin/${b.slug}/spatial/boundary.geojson`;
    const modelGisBoundary = join(process.cwd(), "..", "flood-analysis-model", "dataset", b.slug, "gis", `${b.slug}_boundary.geojson`);
    let boundaryGeoJson: any = null;

    if (existsSync(modelGisBoundary)) {
      try {
        boundaryGeoJson = JSON.parse(readFileSync(modelGisBoundary, "utf-8"));
      } catch {
        boundaryGeoJson = null;
      }
    }

    if (boundaryGeoJson) {
      await r2Storage.putJson(boundaryPath, boundaryGeoJson, "public, max-age=604800, s-maxage=604800");
      if (!b.boundaryGeojsonPath) {
        await db.update(basins).set({ boundaryGeojsonPath: boundaryPath }).where(eq(basins.id, b.id));
      }
    }

    // 5. spatial/rivers.geojson
    const riversPath = `basin/${b.slug}/spatial/rivers.geojson`;
    const modelRiverNetwork = join(process.cwd(), "..", "flood-analysis-model", "dataset", b.slug, "processed", "river_network_main.geojson");
    const modelOsmWaterways = join(process.cwd(), "..", "flood-analysis-model", "dataset", b.slug, "gis", "osm_waterways.geojson");
    const realRiverFile = existsSync(modelRiverNetwork) ? modelRiverNetwork : (existsSync(modelOsmWaterways) ? modelOsmWaterways : null);

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

      // 3. Publish individual stations
      const { all: bStations } = await this.getStationsForBasin(b.id);
      stationsCount += bStations.length;

      for (const st of bStations) {
        await this.publishStationDatasets(st.id, teleMap);
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
