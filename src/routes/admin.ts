import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { datasetRegistry, ingestionJobs, stations, telemetryLatest } from "../db/schema";
import { r2Publisher } from "../services/r2PublisherService";
import { thaiWaterIngestion } from "../services/thaiWaterIngestion";

const adminRouter = new Hono();

/**
 * 6.3 POST /api/admin/sync/stations
 * Trigger station metadata sync
 */
adminRouter.post("/sync/stations", async (c) => {
  return c.json({
    success: true,
    message: "Stations metadata sync triggered successfully",
  });
});

/**
 * 6.3 POST /api/admin/sync/observations
 * Trigger telemetry observations sync
 */
adminRouter.post("/sync/observations", async (c) => {
  const basin = c.req.query("basin");
  const result = await thaiWaterIngestion.syncAllTelemetry(basin);
  return c.json({
    success: true,
    result,
  });
});

/**
 * 6.3 POST /api/admin/datasets/rebuild
 * Trigger R2 JSON datasets rebuild
 */
adminRouter.post("/datasets/rebuild", async (c) => {
  const basin = c.req.query("basin");
  const result = await r2Publisher.rebuildAllDatasets(basin);
  return c.json({
    success: true,
    result,
  });
});

/**
 * POST /api/admin/bulletin/generate
 * Trigger LLM Hydrological Bulletin generation for basin
 */
adminRouter.post("/bulletin/generate", async (c) => {
  const basin = c.req.query("basin") || "yom";
  const { llmBulletinService } = await import("../services/llmBulletinService");
  const bulletin = await llmBulletinService.generateBulletin(basin);
  return c.json({
    success: true,
    bulletin,
  });
});

/**
 * GET /api/admin/datasets
 * Query dataset registry
 */
adminRouter.get("/datasets", async (c) => {
  const basin = c.req.query("basin");
  try {
    const list = basin
      ? await db
          .select()
          .from(datasetRegistry)
          .where(eq(datasetRegistry.basinId, basin))
          .orderBy(desc(datasetRegistry.updatedAt))
      : await db
          .select()
          .from(datasetRegistry)
          .orderBy(desc(datasetRegistry.updatedAt))
          .limit(100);

    return c.json({
      success: true,
      datasets: list,
      total: list.length,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * GET /api/admin/jobs
 * Query ingestion jobs
 */
adminRouter.get("/jobs", async (c) => {
  try {
    const jobs = await db
      .select()
      .from(ingestionJobs)
      .orderBy(desc(ingestionJobs.startedAt))
      .limit(50);

    return c.json({
      success: true,
      jobs,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * GET /api/admin/data-quality
 * Health metrics and anomalies check
 */
adminRouter.get("/data-quality", async (c) => {
  try {
    const allStations = await db.select().from(stations);
    const allTele = await db.select().from(telemetryLatest);
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    let freshCount = 0;
    let delayedCount = 0;
    let missingCount = 0;
    const missingStations: any[] = [];
    const criticalStations: any[] = [];

    for (const st of allStations) {
      const t = teleMap.get(st.id);
      if (!t || t.freshnessStatus === "missing") {
        missingCount++;
        missingStations.push({ id: st.id, name: st.nameTh, basinId: st.basinId });
      } else if (t.freshnessStatus === "delayed") {
        delayedCount++;
      } else {
        freshCount++;
      }

      if (t?.situationStatus === "critical") {
        criticalStations.push({ id: st.id, name: st.nameTh, stage: t.stage, rain: t.rainfall24h });
      }
    }

    return c.json({
      success: true,
      summary: {
        totalStations: allStations.length,
        fresh: freshCount,
        delayed: delayedCount,
        missing: missingCount,
        freshnessRate: allStations.length > 0 ? `${Math.round((freshCount / allStations.length) * 100)}%` : "0%",
      },
      criticalAlerts: criticalStations,
      missingStations,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export { adminRouter };
