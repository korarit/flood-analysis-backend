import { Hono } from "hono";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import { basins, datasetRegistry, ingestionJobs, telemetryLatest } from "../db/schema";
import { r2Publisher } from "../services/r2PublisherService";
import { r2Storage } from "../services/r2StorageService";
import { stationImporter } from "../services/stationImporterService";
import { thaiWaterIngestion } from "../services/thaiWaterIngestion";
import { CreateBasinDto, RainfallStationArrayDto, WaterlevelStationArrayDto } from "../types/dto";

const adminRouter = new Hono();

/**
 * Helper to parse JSON or multipart/form-data payload
 */
async function parseJsonOrMultipart(c: any): Promise<{ data: any; filename: string }> {
  const contentType = c.req.header("content-type") || "";
  let data: any;
  let filename = c.req.query("filename") || "";

  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (file instanceof File) {
      filename = filename || file.name;
      const text = await file.text();
      data = JSON.parse(text);
    } else if (typeof file === "string") {
      data = JSON.parse(file);
    }
  } else {
    data = await c.req.json();
  }

  return { data, filename };
}

/**
 * POST /api/admin/basins
 * Create a new river basin in PostgreSQL and auto-publish to R2 basins.json
 */
adminRouter.post("/basins", async (c) => {
  try {
    const body = await c.req.json();
    const parseRes = CreateBasinDto.safeParse(body);
    if (!parseRes.success) {
      return c.json({ success: false, error: "Validation failed", details: parseRes.error.format() }, 400);
    }

    const { slug, code, nameTh, nameEn, descriptionTh, descriptionEn, areaKm2, isActive } = parseRes.data;

    // Check if slug or code already exists
    const [existing] = await db
      .select()
      .from(basins)
      .where(or(eq(basins.slug, slug), eq(basins.code, code)));

    if (existing) {
      return c.json({
        success: false,
        error: `Basin with slug '${slug}' or code '${code}' already exists in database.`,
      }, 409);
    }

    const [created] = await db
      .insert(basins)
      .values({
        id: slug,
        slug,
        code,
        nameTh,
        nameEn,
        descriptionTh: descriptionTh || null,
        descriptionEn: descriptionEn || null,
        areaKm2: areaKm2 || null,
        boundaryGeojsonPath: null,
        isActive: isActive !== undefined ? isActive : true,
        status: "active",
      })
      .returning();

    // Auto-update R2 basins.json
    await r2Publisher.publishBasinsList();

    return c.json({
      success: true,
      message: `Basin '${slug}' created successfully`,
      data: created,
    }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/admin/stations/upload/waterlevel?basin=xxx
 * Upload Waterlevel Stations JSON with strict DTO validation and basin existence verification.
 */
adminRouter.post("/stations/upload/waterlevel", async (c) => {
  try {
    const basinSlug = c.req.query("basin") || "";
    if (!basinSlug) {
      return c.json({ success: false, error: "Missing required query parameter ?basin=xxx" }, 400);
    }

    // Verify basin exists in DB
    const [b] = await db.select().from(basins).where(or(eq(basins.slug, basinSlug), eq(basins.id, basinSlug)));
    if (!b) {
      return c.json({
        success: false,
        error: `Basin '${basinSlug}' not found in database. Please create the basin first via POST /api/admin/basins.`,
      }, 404);
    }

    const { data } = await parseJsonOrMultipart(c);

    // Validate DTO
    const validation = WaterlevelStationArrayDto.safeParse(data);
    if (!validation.success) {
      return c.json({
        success: false,
        error: "DTO validation failed for waterlevel station payload",
        details: validation.error.format(),
      }, 400);
    }

    const result = await stationImporter.importWaterlevelStations(validation.data, b.slug);

    return c.json({
      success: true,
      message: `Successfully processed ${result.insertedOrUpdated} waterlevel stations for basin '${b.slug}' and published to R2`,
      data: result,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/admin/stations/upload/rainfall?basin=xxx
 * Upload Rainfall Stations JSON with strict DTO validation and basin existence verification.
 */
adminRouter.post("/stations/upload/rainfall", async (c) => {
  try {
    const basinSlug = c.req.query("basin") || "";
    if (!basinSlug) {
      return c.json({ success: false, error: "Missing required query parameter ?basin=xxx" }, 400);
    }

    // Verify basin exists in DB
    const [b] = await db.select().from(basins).where(or(eq(basins.slug, basinSlug), eq(basins.id, basinSlug)));
    if (!b) {
      return c.json({
        success: false,
        error: `Basin '${basinSlug}' not found in database. Please create the basin first via POST /api/admin/basins.`,
      }, 404);
    }

    const { data } = await parseJsonOrMultipart(c);

    // Validate DTO
    const validation = RainfallStationArrayDto.safeParse(data);
    if (!validation.success) {
      return c.json({
        success: false,
        error: "DTO validation failed for rainfall station payload",
        details: validation.error.format(),
      }, 400);
    }

    const result = await stationImporter.importRainfallStations(validation.data, b.slug);

    return c.json({
      success: true,
      message: `Successfully processed ${result.insertedOrUpdated} rainfall stations for basin '${b.slug}' and published to R2`,
      data: result,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/admin/stations/upload
 * Legacy auto-detect upload endpoint (redirects/delegates to waterlevel or rainfall)
 */
adminRouter.post("/stations/upload", async (c) => {
  try {
    const { data, filename } = await parseJsonOrMultipart(c);
    const basinSlug = c.req.query("basin") || "";

    if (!Array.isArray(data)) {
      return c.json({ success: false, error: "Expected an array of station objects" }, 400);
    }

    const firstItem = data[0];
    const isWaterlevel =
      firstItem?.station?.ground_level !== undefined ||
      firstItem?.station?.min_bank !== undefined ||
      firstItem?.station?.tele_station_type === "waterlevel" ||
      filename.includes("waterlevel");

    let result;
    if (isWaterlevel) {
      const validation = WaterlevelStationArrayDto.safeParse(data);
      if (!validation.success) {
        return c.json({ success: false, error: "DTO validation failed", details: validation.error.format() }, 400);
      }
      result = await stationImporter.importWaterlevelStations(validation.data, basinSlug || filename);
    } else {
      const validation = RainfallStationArrayDto.safeParse(data);
      if (!validation.success) {
        return c.json({ success: false, error: "DTO validation failed", details: validation.error.format() }, 400);
      }
      result = await stationImporter.importRainfallStations(validation.data, basinSlug || filename);
    }

    return c.json({
      success: true,
      message: `Successfully processed ${result.insertedOrUpdated} stations and published to R2`,
      data: result,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/admin/relations/upload
 * Upload & Auto Upsert relation_waterlevel_frontend.json
 * Automatically triggers R2 relation datasets publishing immediately!
 */
adminRouter.post("/relations/upload", async (c) => {
  try {
    let payload: any;
    let basinHint = c.req.query("basin") || "";

    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (file instanceof File) {
        const text = await file.text();
        payload = JSON.parse(text);
      }
    } else {
      payload = await c.req.json();
    }

    if (!Array.isArray(payload)) {
      return c.json({ success: false, error: "Expected an array of station relation objects" }, 400);
    }

    const result = await stationImporter.importRelations(payload, basinHint);
    return c.json({
      success: true,
      message: `Successfully processed relations (${result.inserted} inserted/updated) and published to R2`,
      data: result,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/admin/import-all-datasets
 * Auto scan and import all datasets from flood-analysis-model/dataset/
 */
adminRouter.post("/import-all-datasets", async (c) => {
  const modelDatasetDir = join(process.cwd(), "..", "flood-analysis-model", "dataset");
  if (!existsSync(modelDatasetDir)) {
    return c.json({ success: false, error: `Dataset directory not found: ${modelDatasetDir}` }, 404);
  }

  const results: any[] = [];
  try {
    const basinFolders = readdirSync(modelDatasetDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const slug of basinFolders) {
      const stationDir = join(modelDatasetDir, slug, "station");
      const processedDir = join(modelDatasetDir, slug, "processed");

      // 1. Waterlevel stations
      const wlFile = join(stationDir, `${slug}_waterlevel_stations.json`);
      if (existsSync(wlFile)) {
        const data = JSON.parse(readFileSync(wlFile, "utf-8"));
        const res = await stationImporter.importWaterlevelStations(data, `${slug}_waterlevel_stations.json`);
        results.push({ basin: slug, file: `${slug}_waterlevel_stations.json`, res });
      }

      // 2. Rainfall stations
      const rainFile = join(stationDir, `${slug}_rain_stations.json`);
      if (existsSync(rainFile)) {
        const data = JSON.parse(readFileSync(rainFile, "utf-8"));
        const res = await stationImporter.importRainfallStations(data, `${slug}_rain_stations.json`);
        results.push({ basin: slug, file: `${slug}_rain_stations.json`, res });
      }

      // 3. Relations (Prioritize relations_frontend.json, fallback to relation_waterlevel_frontend.json)
      const relFrontend = join(processedDir, "relations_frontend.json");
      const relWaterlevel = join(processedDir, "relation_waterlevel_frontend.json");
      const targetRelFile = existsSync(relFrontend) ? relFrontend : existsSync(relWaterlevel) ? relWaterlevel : null;

      if (targetRelFile) {
        const data = JSON.parse(readFileSync(targetRelFile, "utf-8"));
        const res = await stationImporter.importRelations(data, slug);
        results.push({ basin: slug, file: basename(targetRelFile), res });
      }
    }

    // Rebuild global basins list
    await r2Publisher.publishBasinsList();

    return c.json({
      success: true,
      message: `Finished importing datasets across ${basinFolders.length} basin folders`,
      results,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * 6.3 POST /api/admin/sync/observations
 * Trigger telemetry observations sync (Scrapes day-by-day & writes to R2)
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
 * Trigger R2 JSON datasets rebuild for all active basins
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
    const { all: allStations } = await r2Publisher.getStationsForBasin();
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

/**
 * POST /api/admin/basins/:slug/boundary
 * Upload boundary GeoJSON for a basin, publish directly to R2, and save file path in DB.
 * In DB, boundaryGeojsonPath will be set to 'basin/{slug}/spatial/boundary.geojson' (or null if not uploaded).
 */
adminRouter.post("/basins/:slug/boundary", async (c) => {
  const slug = c.req.param("slug");

  try {
    const [basin] = await db.select().from(basins).where(eq(basins.slug, slug));
    if (!basin) {
      return c.json({ success: false, error: `Basin with slug '${slug}' not found` }, 404);
    }

    let geoJsonData: any;
    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (file instanceof File) {
        const text = await file.text();
        geoJsonData = JSON.parse(text);
      } else if (typeof file === "string") {
        geoJsonData = JSON.parse(file);
      }
    } else {
      geoJsonData = await c.req.json();
    }

    if (!geoJsonData || (geoJsonData.type !== "FeatureCollection" && geoJsonData.type !== "Feature")) {
      return c.json({
        success: false,
        error: "Invalid GeoJSON format. Expected FeatureCollection or Feature",
      }, 400);
    }

    // 1. Upload GeoJSON directly to R2 at basin/{slug}/spatial/boundary.geojson
    const r2Key = `basin/${slug}/spatial/boundary.geojson`;
    await r2Storage.putJson(r2Key, geoJsonData, "public, max-age=604800, s-maxage=604800");

    // 2. Save only the file path in DB (null = not uploaded yet)
    await db
      .update(basins)
      .set({
        boundaryGeojsonPath: r2Key,
        updatedAt: new Date(),
      })
      .where(eq(basins.slug, slug));

    return c.json({
      success: true,
      message: `Successfully uploaded boundary GeoJSON for '${slug}' to R2 and updated DB`,
      data: {
        basinId: basin.id,
        slug: basin.slug,
        boundaryGeojsonPath: r2Key,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export { adminRouter };
