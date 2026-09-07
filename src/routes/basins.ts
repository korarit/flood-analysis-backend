import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins, telemetryLatest } from "../db/schema";
import { BasinDetail, BasinStatusSummary, BasinSummary, SituationStatus } from "../types";
import { r2Publisher } from "../services/r2PublisherService";

const basinsRouter = new Hono();

/**
 * 6.1 GET /api/basins
 * List all river basins with summary stats (supports ?active=true)
 */
basinsRouter.get("/", async (c) => {
  const activeOnly = c.req.query("active") === "true";

  try {
    const allBasins = activeOnly
      ? await db.select().from(basins).where(eq(basins.isActive, true))
      : await db.select().from(basins);

    const { all: allStations } = await r2Publisher.getStationsForBasin();
    const allTele = await db.select().from(telemetryLatest);

    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    const data: (BasinSummary & { isActive: boolean })[] = allBasins.map((b) => {
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
        isActive: b.isActive,
        lastUpdated: b.updatedAt.toISOString(),
        areaKm2: b.areaKm2 || undefined,
      };
    });

    return c.json({
      success: true,
      data,
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
 * 6.2 GET /api/basins/:slug
 * Detailed basin profile and metrics
 */
basinsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  try {
    const [b] = await db.select().from(basins).where(eq(basins.slug, slug));
    if (!b) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Basin with slug '${slug}' not found`,
          },
        },
        404
      );
    }

    const { all: bStations, waterlevel: wlStations, rainfall: rfStations } = await r2Publisher.getStationsForBasin(b.id);
    const allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    let normalCount = 0;
    let watchCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let missingCount = 0;
    let risingCount = 0;
    let heavyRainCount = 0;

    for (const st of bStations) {
      const t = teleMap.get(st.id);
      const status = (t?.situationStatus as SituationStatus) || "normal";

      if (status === "critical") criticalCount++;
      else if (status === "warning") warningCount++;
      else if (status === "watch") watchCount++;
      else if (status === "missing") missingCount++;
      else normalCount++;

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

    const data: BasinDetail & { isActive: boolean } = {
      id: b.id,
      slug: b.slug,
      code: b.code,
      name: { th: b.nameTh, en: b.nameEn },
      description: { th: b.descriptionTh || "", en: b.descriptionEn || "" },
      areaKm2: b.areaKm2 || 0,
      totalStations: bStations.length,
      waterLevelStationsCount: wlStations.length,
      rainfallStationsCount: rfStations.length,
      overallStatus,
      statusSummary,
      isActive: b.isActive,
      boundaryGeojsonPath: b.boundaryGeojsonPath,
      lastUpdated: b.updatedAt.toISOString(),
    };

    return c.json({
      success: true,
      data,
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
 * GET /api/basins/:slug/report
 * Fetch latest situation bulletin report for basin
 */
basinsRouter.get("/:slug/report", async (c) => {
  const slug = c.req.param("slug");
  const { llmBulletinService } = await import("../services/llmBulletinService");
  const { r2Storage } = await import("../services/r2StorageService");

  // Try reading from R2 / local mirror first
  const r2Key = `basin/${slug}/report/bulletin-latest.json`;
  const cached = await r2Storage.getJson(r2Key);
  if (cached) {
    return c.json({ success: true, data: cached });
  }

  // Generate on demand if not cached yet
  const bulletin = await llmBulletinService.generateBulletin(slug);
  if (!bulletin) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Basin with slug '${slug}' not found`,
        },
      },
      404
    );
  }

  return c.json({ success: true, data: bulletin });
});

export { basinsRouter };
