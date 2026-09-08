import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { ingestionJobs } from "../db/schema";
import { cronAuthMiddleware } from "../middleware/cronAuth";
import { r2Publisher } from "../services/r2PublisherService";
import { thaiWaterBulkIngestion } from "../services/thaiWaterBulkIngestion";
import { thaiWaterIngestion } from "../services/thaiWaterIngestion";

const cronRouter = new Hono();

// Apply cron authentication middleware to all cron routes
cronRouter.use("/*", cronAuthMiddleware);

/**
 * 2.2 Unified Trigger: POST /api/cron/sync-all
 * Ingests latest ThaiWater observations -> updates DB -> rebuilds & publishes all R2 datasets
 * Query params:
 *   ?basin=yom
 *   ?mode=bulk | legacy
 */
cronRouter.post("/sync-all", async (c) => {
  const basin = c.req.query("basin");
  const modeQuery = c.req.query("mode");
  const isLegacy = modeQuery === "legacy" || (env.THAIWATER_INGESTION_MODE === "legacy" && modeQuery !== "bulk");
  const startTime = new Date();

  // Create job record
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      jobType: "sync_all",
      basinId: basin || "all",
      status: "running",
      recordsProcessed: 0,
      startedAt: startTime,
    })
    .returning();

  try {
    // 1. Scrape and update telemetry in PostgreSQL (Bulk Engine or Legacy Scraper)
    const syncRes = isLegacy
      ? await thaiWaterIngestion.syncAllTelemetry(basin)
      : await thaiWaterBulkIngestion.syncAllTelemetryBulk({ targetBasinSlug: basin, writeStationCurrentJson: true });

    // 2. Rebuild and publish datasets to Cloudflare R2
    const publishRes = await r2Publisher.rebuildAllDatasets(basin);

    // 3. Mark job as completed
    const endTime = new Date();
    await db
      .update(ingestionJobs)
      .set({
        status: "completed",
        recordsProcessed: syncRes.synced,
        finishedAt: endTime,
      })
      .where(eq(ingestionJobs.id, job.id));

    return c.json({
      success: true,
      jobId: job.id,
      engine: isLegacy ? "legacy" : "bulk",
      durationMs: endTime.getTime() - startTime.getTime(),
      summary: {
        basin: basin || "all",
        stationsChecked: syncRes.total,
        stationsSynced: syncRes.synced,
        stationsFailed: syncRes.failed,
        r2BasinsPublished: publishRes.basinsCount,
        r2StationsPublished: publishRes.stationsCount,
      },
      errors: syncRes.errors,
    });
  } catch (err: any) {
    await db
      .update(ingestionJobs)
      .set({
        status: "failed",
        errors: { message: err.message, stack: err.stack },
        finishedAt: new Date(),
      })
      .where(eq(ingestionJobs.id, job.id));

    return c.json(
      {
        success: false,
        jobId: job.id,
        error: {
          code: "SYNC_ERROR",
          message: err.message,
        },
      },
      500
    );
  }
});

/**
 * POST /api/cron/sync-telemetry
 * Scrapes and updates only telemetry in PostgreSQL
 */
cronRouter.post("/sync-telemetry", async (c) => {
  const basin = c.req.query("basin");
  const modeQuery = c.req.query("mode");
  const isLegacy = modeQuery === "legacy" || (env.THAIWATER_INGESTION_MODE === "legacy" && modeQuery !== "bulk");

  try {
    const res = isLegacy
      ? await thaiWaterIngestion.syncAllTelemetry(basin)
      : await thaiWaterBulkIngestion.syncAllTelemetryBulk({ targetBasinSlug: basin, writeStationCurrentJson: true });

    return c.json({
      success: true,
      engine: isLegacy ? "legacy" : "bulk",
      data: res,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/cron/publish-r2
 * Rebuilds and publishes R2 datasets from current DB records without re-scraping
 */
cronRouter.post("/publish-r2", async (c) => {
  const basin = c.req.query("basin");
  try {
    const res = await r2Publisher.rebuildAllDatasets(basin);
    return c.json({
      success: true,
      data: res,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * GET /api/cron/status
 * Get status of recent sync runs
 */
cronRouter.get("/status", async (c) => {
  try {
    const jobs = await db
      .select()
      .from(ingestionJobs)
      .orderBy(desc(ingestionJobs.startedAt))
      .limit(10);

    return c.json({
      success: true,
      jobs,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export { cronRouter };
