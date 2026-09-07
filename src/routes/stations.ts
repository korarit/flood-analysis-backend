import { Hono } from "hono";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { basins, rainfallStations, telemetryLatest, waterlevelStations } from "../db/schema";

const stationsRouter = new Hono();

/**
 * GET /api/stations
 * Dynamic filtering for stations (by basin, type, status, query)
 */
stationsRouter.get("/", async (c) => {
  const basinQuery = c.req.query("basin");
  const typeQuery = c.req.query("type"); // 'water_level' | 'rainfall' | undefined
  const statusQuery = c.req.query("status");
  const searchQuery = c.req.query("q");

  try {
    const list: any[] = [];

    // 1. Fetch Waterlevel Stations if type matches or not specified
    if (!typeQuery || typeQuery === "water_level" || typeQuery === "waterlevel") {
      const conditions = [];
      if (basinQuery) conditions.push(eq(waterlevelStations.basinId, basinQuery));
      if (statusQuery) conditions.push(eq(waterlevelStations.status, statusQuery));
      if (searchQuery) conditions.push(ilike(waterlevelStations.nameTh, `%${searchQuery}%`));

      const wlResults = conditions.length > 0
        ? await db.select().from(waterlevelStations).where(and(...conditions))
        : await db.select().from(waterlevelStations);

      for (const st of wlResults) {
        list.push({ ...st, type: "water_level" });
      }
    }

    // 2. Fetch Rainfall Stations if type matches or not specified
    if (!typeQuery || typeQuery === "rainfall" || typeQuery === "rainfall_24h") {
      const conditions = [];
      if (basinQuery) conditions.push(eq(rainfallStations.basinId, basinQuery));
      if (statusQuery) conditions.push(eq(rainfallStations.status, statusQuery));
      if (searchQuery) conditions.push(ilike(rainfallStations.nameTh, `%${searchQuery}%`));

      const rfResults = conditions.length > 0
        ? await db.select().from(rainfallStations).where(and(...conditions))
        : await db.select().from(rainfallStations);

      for (const st of rfResults) {
        list.push({ ...st, type: "rainfall" });
      }
    }

    const allTele = await db.select().from(telemetryLatest);
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const data = list.map((st) => {
      const t = teleMap.get(st.id);
      const isWL = st.type === "water_level";

      return {
        id: st.id,
        code: st.oldcode || st.id,
        basinId: st.basinId,
        type: st.type,
        name: { th: st.nameTh, en: st.nameEn },
        address: {
          th: `${st.tumbonNameTh || ""} ${st.amphoeNameTh || ""} ${st.provinceNameTh || ""}`.trim(),
          en: `${st.tumbonNameEn || ""} ${st.amphoeNameEn || ""} ${st.provinceNameEn || ""}`.trim(),
        },
        agency: { th: st.agencyNameTh || "", en: st.agencyNameEn || "" },
        river: isWL && st.riverName ? { th: st.riverName, en: st.riverName } : undefined,
        location: {
          lat: st.lat,
          lon: st.lon,
          groundLevelMsl: isWL ? st.groundLevel : null,
          bankLevelMsl: isWL ? st.minBank : null,
          warningLevelMsl: isWL && st.minBank ? st.minBank * 0.85 : null,
          criticalLevelMsl: isWL ? st.minBank : null,
        },
        current: t
          ? {
              stage: t.stage,
              discharge: t.discharge,
              rainfall1h: t.rainfall1h,
              rainfall24h: t.rainfall24h,
              rainfallToday: t.rainfallToday,
              waterLevelMsl: t.waterLevelMsl,
              storagePercent: t.storagePercent,
              trend: t.trend,
              situationStatus: t.situationStatus,
              freshnessStatus: t.freshnessStatus,
              updatedAt: t.timestamp?.toISOString(),
            }
          : undefined,
        status: st.status,
      };
    });

    return c.json({
      success: true,
      data,
      total: data.length,
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: "DB_ERROR",
          message: err.message,
        },
      },
      500
    );
  }
});

/**
 * GET /api/stations/:id
 * Get single station master detail
 */
stationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const [wl] = await db.select().from(waterlevelStations).where(eq(waterlevelStations.id, id));
    const [rf] = !wl ? await db.select().from(rainfallStations).where(eq(rainfallStations.id, id)) : [undefined];
    const st = wl || rf;

    if (!st) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Station with id '${id}' not found`,
          },
        },
        404
      );
    }

    const isWL = !!wl;
    const [t] = await db.select().from(telemetryLatest).where(eq(telemetryLatest.stationId, id));
    const [b] = await db.select().from(basins).where(eq(basins.id, st.basinId));

    return c.json({
      success: true,
      data: {
        id: st.id,
        code: st.oldcode || st.id,
        basin: b ? { id: b.id, slug: b.slug, name: { th: b.nameTh, en: b.nameEn }, isActive: b.isActive } : { id: st.basinId },
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
        current: t
          ? {
              stage: t.stage,
              discharge: t.discharge,
              rainfall1h: t.rainfall1h,
              rainfall24h: t.rainfall24h,
              rainfallToday: t.rainfallToday,
              waterLevelMsl: t.waterLevelMsl,
              storagePercent: t.storagePercent,
              trend: t.trend,
              situationStatus: t.situationStatus,
              freshnessStatus: t.freshnessStatus,
              updatedAt: t.timestamp?.toISOString(),
            }
          : undefined,
        source: {
          provider: "thaiwater",
          sourceStationId: st.id,
        },
        status: st.status,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: "DB_ERROR",
          message: err.message,
        },
      },
      500
    );
  }
});

export { stationsRouter };
