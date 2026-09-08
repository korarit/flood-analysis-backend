import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins, rainfallStations, stationRelations, telemetryLatest, waterlevelStations } from "../db/schema";
import { r2Publisher } from "./r2PublisherService";

export interface StationImportResult {
  success: boolean;
  type: "waterlevel" | "rainfall" | "relation";
  basinId: string;
  total: number;
  insertedOrUpdated: number;
  errors: any[];
  r2Published: boolean;
}

export class StationImporterService {
  /**
   * Helper to normalize basin dynamically from DB or auto-insert if newly discovered
   */
  public async resolveBasin(
    rawBasin: any,
    basinSlugOrHint?: string
  ): Promise<{ id: string; slug: string; code: string; nameTh: string; nameEn: string }> {
    // 1. Fetch all existing basins from DB (DB is the Single Source of Truth)
    const dbBasins = await db.select().from(basins);

    // 2. Check basinSlugOrHint against existing basins in DB
    if (basinSlugOrHint) {
      const lowerHint = basinSlugOrHint.toLowerCase().trim();
      // First try exact match by slug or id
      const exactMatch = dbBasins.find(
        (b) => b.slug.toLowerCase() === lowerHint || b.id.toLowerCase() === lowerHint
      );
      if (exactMatch) {
        return { id: exactMatch.id, slug: exactMatch.slug, code: exactMatch.code, nameTh: exactMatch.nameTh, nameEn: exactMatch.nameEn };
      }

      // Then try substring match (e.g. from filename 'yom_waterlevel_stations.json')
      const matched = dbBasins.find(
        (b) =>
          lowerHint.includes(b.slug.toLowerCase()) ||
          lowerHint.includes(b.id.toLowerCase()) ||
          (b.code && lowerHint.includes(b.code))
      );
      if (matched) {
        return { id: matched.id, slug: matched.slug, code: matched.code, nameTh: matched.nameTh, nameEn: matched.nameEn };
      }
    }

    // 3. Check rawBasin from metadata against existing basins in DB
    if (rawBasin) {
      const thName = (rawBasin.basin_name?.th || "").trim();
      const enName = (rawBasin.basin_name?.en || "").trim();
      const codeNum = Number(rawBasin.basin_code || rawBasin.id);
      const codeStr = String(rawBasin.basin_code || rawBasin.id || "").trim();
      const codePadded = !isNaN(codeNum) && codeNum > 0 ? String(codeNum).padStart(2, "0") : codeStr;

      const matched = dbBasins.find(
        (b) =>
          (codePadded && b.code === codePadded) ||
          (codeStr && b.code === codeStr) ||
          (thName && b.nameTh === thName) ||
          (enName && b.nameEn.toLowerCase() === enName.toLowerCase()) ||
          (b.slug && enName && b.slug.toLowerCase() === enName.toLowerCase().replace(/[^a-z0-9]/g, "-"))
      );
      if (matched) {
        return { id: matched.id, slug: matched.slug, code: matched.code, nameTh: matched.nameTh, nameEn: matched.nameEn };
      }

      throw new Error(
        `Basin '${thName || enName || codePadded}' not found in database. Please create the basin via POST /api/admin/basins first.`
      );
    }

    throw new Error(
      `Basin '${basinSlugOrHint || "unknown"}' not found in database. Please specify a valid ?basin=xxx or create the basin via POST /api/admin/basins first.`
    );
  }

  /**
   * Import Waterlevel Stations from JSON array
   */
  async importWaterlevelStations(
    data: any[],
    basinSlugOrHint?: string,
    options?: { skipR2?: boolean }
  ): Promise<StationImportResult> {
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, type: "waterlevel", basinId: "unknown", total: 0, insertedOrUpdated: 0, errors: ["No data array provided"], r2Published: false };
    }

    const firstItem = data[0];
    const basinInfo = await this.resolveBasin(firstItem.basin, basinSlugOrHint);

    let count = 0;
    const errors: any[] = [];
    const stationIds: string[] = [];

    const CONCURRENCY = 20;
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const batch = data.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          try {
            const st = item.station || {};
            const agency = item.agency || {};
            const geocode = item.geocode || {};
            const stationId = String(st.id || "").trim();

            if (!stationId) return;

            const record = {
              id: stationId,
              basinId: basinInfo.id,
              oldcode: st.tele_station_oldcode || null,
              stationType: "waterlevel",
              nameTh: st.tele_station_name?.th || stationId,
              nameEn: st.tele_station_name?.en || st.tele_station_name?.th || stationId,
              lat: Number(st.tele_station_lat) || 0,
              lon: Number(st.tele_station_long) || 0,
              groundLevel: st.ground_level !== null && st.ground_level !== undefined ? Number(st.ground_level) : null,
              minBank: st.min_bank !== null && st.min_bank !== undefined ? Number(st.min_bank) : null,
              qmax: st.qmax !== null && st.qmax !== undefined ? Number(st.qmax) : null,
              riverName: st.river_name || null,
              sponsorBy: st.sponsor_by || null,
              agencyNameTh: agency.agency_name?.th || null,
              agencyNameEn: agency.agency_name?.en || null,
              agencyShortnameTh: agency.agency_shortname?.th || null,
              agencyShortnameEn: agency.agency_shortname?.en || null,
              agencyCode: agency.agency_code || null,
              areaCode: geocode.area_code ? String(geocode.area_code) : null,
              areaNameTh: geocode.area_name?.th || null,
              areaNameEn: geocode.area_name?.en || null,
              amphoeNameTh: geocode.amphoe_name?.th || null,
              amphoeNameEn: geocode.amphoe_name?.en || null,
              tumbonNameTh: geocode.tumbon_name?.th || null,
              tumbonNameEn: geocode.tumbon_name?.en || null,
              provinceCode: geocode.province_code ? String(geocode.province_code) : null,
              provinceNameTh: geocode.province_name?.th || null,
              provinceNameEn: geocode.province_name?.en || null,
              geoCode: geocode.geo_code ? String(geocode.geo_code) : null,
              ridCode: geocode.rid_code ? String(geocode.rid_code) : null,
              tmdCode: geocode.tmd_code ? String(geocode.tmd_code) : null,
              status: "active",
              rawMetadata: item,
              updatedAt: new Date(),
            };

            // Auto Insert & Auto Update (Upsert)
            await db
              .insert(waterlevelStations)
              .values(record)
              .onConflictDoUpdate({
                target: waterlevelStations.id,
                set: record,
              });

            stationIds.push(stationId);
            count++;
          } catch (err: any) {
            errors.push({ id: item.station?.id, error: err.message });
          }
        })
      );
    }

    // Auto-Publish R2 Datasets for Frontend (Skipped if skipR2: true)
    let r2Published = false;
    if (!options?.skipR2) {
      try {
        await r2Publisher.publishBasinStationsList(basinInfo.slug);
        await r2Publisher.publishBasinOverview(basinInfo.slug);
        await r2Publisher.publishBasinsList();

        const allTele = await db.select().from(telemetryLatest);
        const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

        const CONCURRENCY = 50;
        for (let i = 0; i < stationIds.length; i += CONCURRENCY) {
          const batch = stationIds.slice(i, i + CONCURRENCY);
          await Promise.all(
            batch.map((sid) =>
              r2Publisher.publishStationDatasets(sid, teleMap).catch(() => {})
            )
          );
        }
        r2Published = true;
      } catch (pubErr) {
        console.warn("⚠️ R2 auto-publishing after waterlevel import encountered warning:", pubErr);
      }
    }

    return {
      success: true,
      type: "waterlevel",
      basinId: basinInfo.id,
      total: data.length,
      insertedOrUpdated: count,
      errors,
      r2Published,
    };
  }

  /**
   * Import Rainfall Stations from JSON array
   */
  async importRainfallStations(
    data: any[],
    basinSlugOrHint?: string,
    options?: { skipR2?: boolean }
  ): Promise<StationImportResult> {
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, type: "rainfall", basinId: "unknown", total: 0, insertedOrUpdated: 0, errors: ["No data array provided"], r2Published: false };
    }

    const firstItem = data[0];
    const basinInfo = await this.resolveBasin(firstItem.basin, basinSlugOrHint);

    let count = 0;
    const errors: any[] = [];
    const stationIds: string[] = [];

    const CONCURRENCY = 20;
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const batch = data.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          try {
            const st = item.station || {};
            const agency = item.agency || {};
            const geocode = item.geocode || {};
            const stationId = String(st.id || "").trim();

            if (!stationId) return;

            const record = {
              id: stationId,
              basinId: basinInfo.id,
              oldcode: st.tele_station_oldcode || null,
              stationType: "rainfall_24h",
              subBasinId: st.sub_basin_id ? String(st.sub_basin_id) : null,
              subBasinName: st.sub_basin_name || null,
              sponsorBy: st.sponsor_by || null,
              nameTh: st.tele_station_name?.th || stationId,
              nameEn: st.tele_station_name?.en || st.tele_station_name?.th || stationId,
              lat: Number(st.tele_station_lat) || 0,
              lon: Number(st.tele_station_long) || 0,
              warningZone: geocode.warning_zone ? String(geocode.warning_zone) : null,
              warningRain24h: 35.0,
              criticalRain24h: 90.0,
              agencyNameTh: agency.agency_name?.th || null,
              agencyNameEn: agency.agency_name?.en || null,
              agencyShortnameTh: agency.agency_shortname?.th || null,
              agencyShortnameEn: agency.agency_shortname?.en || null,
              areaCode: geocode.area_code ? String(geocode.area_code) : null,
              areaNameTh: geocode.area_name?.th || null,
              areaNameEn: geocode.area_name?.en || null,
              amphoeNameTh: geocode.amphoe_name?.th || null,
              amphoeNameEn: geocode.amphoe_name?.en || null,
              tumbonNameTh: geocode.tumbon_name?.th || null,
              tumbonNameEn: geocode.tumbon_name?.en || null,
              provinceCode: geocode.province_code ? String(geocode.province_code) : null,
              provinceNameTh: geocode.province_name?.th || null,
              provinceNameEn: geocode.province_name?.en || null,
              status: "active",
              rawMetadata: item,
              updatedAt: new Date(),
            };

            // Auto Insert & Auto Update (Upsert)
            await db
              .insert(rainfallStations)
              .values(record)
              .onConflictDoUpdate({
                target: rainfallStations.id,
                set: record,
              });

            stationIds.push(stationId);
            count++;
          } catch (err: any) {
            errors.push({ id: item.station?.id, error: err.message });
          }
        })
      );
    }

    // Auto-Publish R2 Datasets for Frontend (Skipped if skipR2: true)
    let r2Published = false;
    if (!options?.skipR2) {
      try {
        await r2Publisher.publishBasinStationsList(basinInfo.slug);
        await r2Publisher.publishBasinOverview(basinInfo.slug);
        await r2Publisher.publishBasinsList();

        const allTele = await db.select().from(telemetryLatest);
        const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

        const CONCURRENCY = 50;
        for (let i = 0; i < stationIds.length; i += CONCURRENCY) {
          const batch = stationIds.slice(i, i + CONCURRENCY);
          await Promise.all(
            batch.map((sid) =>
              r2Publisher.publishStationDatasets(sid, teleMap).catch(() => {})
            )
          );
        }
        r2Published = true;
      } catch (pubErr) {
        console.warn("⚠️ R2 auto-publishing after rainfall import encountered warning:", pubErr);
      }
    }

    return {
      success: true,
      type: "rainfall",
      basinId: basinInfo.id,
      total: data.length,
      insertedOrUpdated: count,
      errors,
      r2Published,
    };
  }

  /**
   * Import Relation Data from relations_frontend.json
   * 1. Stores influencingRainfallStations and streamFall in waterlevel_stations metadata
   * 2. Inverts relation and stores receivingWaterlevelStations in rainfall_stations metadata
   * 3. Inserts normalized graph edges into station_relations table
   * 4. Auto-publishes updated R2 datasets for all affected stations
   */
  async importRelations(
    data: any[],
    basinSlugHint?: string,
    options?: { skipR2?: boolean }
  ): Promise<{ success: boolean; total: number; inserted: number; errors: any[] }> {
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, total: 0, inserted: 0, errors: ["No relation data array provided"] };
    }

    let inserted = 0;
    const errors: any[] = [];
    const touchedStationIds = new Set<string>();
    const rainfallReceiversMap = new Map<string, Array<any>>();
    const relationsToInsert: any[] = [];

    const allWL = await db
      .select({ id: waterlevelStations.id, nameTh: waterlevelStations.nameTh, nameEn: waterlevelStations.nameEn })
      .from(waterlevelStations);
    const wlMap = new Map(allWL.map((w) => [w.id, w]));

    for (const item of data) {
      const sourceId = String(item.stationId || "").trim();
      if (!sourceId) continue;
      touchedStationIds.add(sourceId);

      const influencingList = Array.isArray(item.influencingStations) ? item.influencingStations : [];
      const downstreamList = Array.isArray(item.downstreamStations) ? item.downstreamStations : [];

      // 1. Update waterlevel_stations metadata (influencingRainfallStations & streamFall)
      try {
        const currentWL = wlMap.get(sourceId);
        if (currentWL) {
          const [fullWL] = await db.select().from(waterlevelStations).where(eq(waterlevelStations.id, sourceId));
          const existingMeta = (fullWL?.rawMetadata as Record<string, any>) || {};
          await db
            .update(waterlevelStations)
            .set({
              rawMetadata: {
                ...existingMeta,
                relations: {
                  influencingRainfallStations: influencingList,
                  streamFall: downstreamList,
                  downstreamStations: downstreamList,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(waterlevelStations.id, sourceId));
        }
      } catch (err: any) {
        errors.push({ sourceId, error: `Failed to update waterlevel metadata: ${err.message}` });
      }

      // 2. Clean old relations for this sourceId to ensure idempotency
      try {
        await db.delete(stationRelations).where(eq(stationRelations.stationId, sourceId));
      } catch (delErr) {
        // Ignore
      }

      // 3. Process Downstream Stations (Stream Fall)
      for (const ds of downstreamList) {
        const targetId = String(ds.stationId || "").trim();
        if (!targetId) continue;
        touchedStationIds.add(targetId);

        relationsToInsert.push({
          stationId: sourceId,
          targetStationId: targetId,
          relationType: "downstream",
          distanceKm: ds.distanceKm !== null && ds.distanceKm !== undefined ? Number(ds.distanceKm) : null,
          travelTimeHours: ds.travelTimeHours !== null && ds.travelTimeHours !== undefined ? Number(ds.travelTimeHours) : null,
          travelTimeMinutes: ds.travelTimeMinutes !== null && ds.travelTimeMinutes !== undefined ? Number(ds.travelTimeMinutes) : null,
          travelTimeHoursMin: ds.travelTimeHoursMin !== null && ds.travelTimeHoursMin !== undefined ? Number(ds.travelTimeHoursMin) : null,
          travelTimeHoursMax: ds.travelTimeHoursMax !== null && ds.travelTimeHoursMax !== undefined ? Number(ds.travelTimeHoursMax) : null,
          travelTimeMinutesMin: ds.travelTimeMinutesMin !== null && ds.travelTimeMinutesMin !== undefined ? Number(ds.travelTimeMinutesMin) : null,
          travelTimeMinutesMax: ds.travelTimeMinutesMax !== null && ds.travelTimeMinutesMax !== undefined ? Number(ds.travelTimeMinutesMax) : null,
          riverSlope: ds.riverSlope !== null && ds.riverSlope !== undefined ? Number(ds.riverSlope) : null,
          elevationDiffM: ds.elevationDiffM !== null && ds.elevationDiffM !== undefined ? Number(ds.elevationDiffM) : null,
          confidence: ds.confidence || null,
          responseType: ds.responseType || null,
          rawMetadata: ds,
        });
      }

      // 4. Process Influencing Stations (Rainfall -> Waterlevel) & Accumulate Inverted Index
      const wlInfo = wlMap.get(sourceId);
      const wlDisplayName = wlInfo ? wlInfo.nameTh : (item.stationName || sourceId);

      for (const inf of influencingList) {
        const rfId = String(inf.stationId || "").trim();
        if (!rfId) continue;
        touchedStationIds.add(rfId);

        // Accumulate for rainfall station
        if (!rainfallReceiversMap.has(rfId)) {
          rainfallReceiversMap.set(rfId, []);
        }
        rainfallReceiversMap.get(rfId)!.push({
          stationId: sourceId,
          stationName: wlDisplayName,
          stationType: "water_level",
          distanceKm: inf.distanceKm !== null && inf.distanceKm !== undefined ? Number(inf.distanceKm) : null,
          travelTimeHours: inf.travelTimeHours !== null && inf.travelTimeHours !== undefined ? Number(inf.travelTimeHours) : null,
          travelTimeMinutes: inf.travelTimeMinutes !== null && inf.travelTimeMinutes !== undefined ? Number(inf.travelTimeMinutes) : null,
          travelTimeHoursMin: inf.travelTimeHoursMin !== null && inf.travelTimeHoursMin !== undefined ? Number(inf.travelTimeHoursMin) : null,
          travelTimeHoursMax: inf.travelTimeHoursMax !== null && inf.travelTimeHoursMax !== undefined ? Number(inf.travelTimeHoursMax) : null,
          travelTimeMinutesMin: inf.travelTimeMinutesMin !== null && inf.travelTimeMinutesMin !== undefined ? Number(inf.travelTimeMinutesMin) : null,
          travelTimeMinutesMax: inf.travelTimeMinutesMax !== null && inf.travelTimeMinutesMax !== undefined ? Number(inf.travelTimeMinutesMax) : null,
          influenceWeightPercent: inf.influenceWeightPercent !== null && inf.influenceWeightPercent !== undefined ? Number(inf.influenceWeightPercent) : null,
          rainfallThresholds: inf.rainfallThresholds || null,
        });

        relationsToInsert.push({
          stationId: sourceId,
          targetStationId: rfId,
          relationType: "influencing",
          distanceKm: inf.distanceKm !== null && inf.distanceKm !== undefined ? Number(inf.distanceKm) : null,
          travelTimeHours: inf.travelTimeHours !== null && inf.travelTimeHours !== undefined ? Number(inf.travelTimeHours) : null,
          travelTimeMinutes: inf.travelTimeMinutes !== null && inf.travelTimeMinutes !== undefined ? Number(inf.travelTimeMinutes) : null,
          travelTimeHoursMin: inf.travelTimeHoursMin !== null && inf.travelTimeHoursMin !== undefined ? Number(inf.travelTimeHoursMin) : null,
          travelTimeHoursMax: inf.travelTimeHoursMax !== null && inf.travelTimeHoursMax !== undefined ? Number(inf.travelTimeHoursMax) : null,
          travelTimeMinutesMin: inf.travelTimeMinutesMin !== null && inf.travelTimeMinutesMin !== undefined ? Number(inf.travelTimeMinutesMin) : null,
          travelTimeMinutesMax: inf.travelTimeMinutesMax !== null && inf.travelTimeMinutesMax !== undefined ? Number(inf.travelTimeMinutesMax) : null,
          confidence: inf.confidence || null,
          responseType: inf.responseType || null,
          rawMetadata: inf,
        });
      }
    }

    // Batch Insert All Relations in chunks of 100
    const REL_BATCH = 100;
    for (let i = 0; i < relationsToInsert.length; i += REL_BATCH) {
      const batch = relationsToInsert.slice(i, i + REL_BATCH);
      try {
        await db.insert(stationRelations).values(batch);
        inserted += batch.length;
      } catch (err: any) {
        errors.push({ batchIndex: i, error: err.message });
      }
    }

    // 5. Update rainfall_stations metadata with receivingWaterlevelStations concurrently
    const rfEntries = Array.from(rainfallReceiversMap.entries());
    const CONCURRENCY = 20;
    for (let i = 0; i < rfEntries.length; i += CONCURRENCY) {
      const batch = rfEntries.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ([rfId, receivers]) => {
          try {
            const [currentRF] = await db.select().from(rainfallStations).where(eq(rainfallStations.id, rfId));
            if (currentRF) {
              const existingMeta = (currentRF.rawMetadata as Record<string, any>) || {};
              await db
                .update(rainfallStations)
                .set({
                  rawMetadata: {
                    ...existingMeta,
                    relations: {
                      receivingWaterlevelStations: receivers,
                    },
                  },
                  updatedAt: new Date(),
                })
                .where(eq(rainfallStations.id, rfId));
            }
          } catch (rfErr: any) {
            errors.push({ rfId, error: `Failed to update rainfall metadata: ${rfErr.message}` });
          }
        })
      );
    }

    // 6. Auto-Publish R2 relations for all touched stations (Skipped if skipR2: true)
    if (!options?.skipR2) {
      try {
        const allTele = await db.select().from(telemetryLatest);
        const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

        const touchedList = Array.from(touchedStationIds);
        const CONCURRENCY = 50;
        for (let i = 0; i < touchedList.length; i += CONCURRENCY) {
          const batch = touchedList.slice(i, i + CONCURRENCY);
          await Promise.all(
            batch.map((sid) =>
              r2Publisher.publishStationDatasets(sid, teleMap).catch(() => {})
            )
          );
        }
      } catch (pubErr) {
        console.warn("⚠️ R2 auto-publishing after relations import encountered warning:", pubErr);
      }
    }

    return {
      success: true,
      total: data.length,
      inserted,
      errors,
    };
  }
}

export const stationImporter = new StationImporterService();
