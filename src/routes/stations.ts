import { Hono } from "hono";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { basins, stations, telemetryLatest } from "../db/schema";

const stationsRouter = new Hono();

/**
 * GET /api/stations
 * Dynamic filtering for stations (by basin, type, status, query)
 */
stationsRouter.get("/", async (c) => {
  const basinQuery = c.req.query("basin");
  const typeQuery = c.req.query("type");
  const statusQuery = c.req.query("status");
  const searchQuery = c.req.query("q");

  try {
    const conditions = [];

    if (basinQuery) {
      conditions.push(eq(stations.basinId, basinQuery));
    }
    if (typeQuery) {
      conditions.push(eq(stations.type, typeQuery));
    }
    if (statusQuery) {
      conditions.push(eq(stations.status, statusQuery));
    }
    if (searchQuery) {
      conditions.push(ilike(stations.nameTh, `%${searchQuery}%`));
    }

    const results =
      conditions.length > 0
        ? await db
            .select()
            .from(stations)
            .where(and(...conditions))
        : await db.select().from(stations);

    const allTele = await db.select().from(telemetryLatest);
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const data = results.map((st) => {
      const t = teleMap.get(st.id);
      return {
        id: st.id,
        code: st.code || st.id,
        basinId: st.basinId,
        type: st.type,
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
    const [st] = await db.select().from(stations).where(eq(stations.id, id));
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

    const [t] = await db.select().from(telemetryLatest).where(eq(telemetryLatest.stationId, id));
    const [b] = await db.select().from(basins).where(eq(basins.id, st.basinId));

    return c.json({
      success: true,
      data: {
        id: st.id,
        code: st.code || st.id,
        basin: b ? { id: b.id, slug: b.slug, name: { th: b.nameTh, en: b.nameEn } } : { id: st.basinId },
        type: st.type,
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
          provider: st.source,
          sourceStationId: st.sourceStationId || st.id,
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
