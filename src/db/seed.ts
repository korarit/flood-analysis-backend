import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "./index";
import { basins, rainfallStations, stationRelations, telemetryLatest, waterlevelStations } from "./schema";
import { r2Publisher } from "../services/r2PublisherService";
import { stationImporter } from "../services/stationImporterService";
import { getModelDatasetDir } from "../config/paths";

import { MASTER_BASINS } from "../config/basins";

export const initialBasins = MASTER_BASINS.map((b) => ({
  id: b.id,
  slug: b.slug,
  code: b.code,
  nameTh: b.nameTh,
  nameEn: b.nameEn,
  descriptionTh: b.descriptionTh,
  descriptionEn: b.descriptionEn,
  areaKm2: b.areaKm2,
  boundaryGeojsonPath: null as string | null,
  isActive: b.isActive,
  status: b.status,
}));

export async function seedDatabase() {
  console.log("🌱 Starting Database Seeding...");

  try {
    const now = new Date();

    // 1. Seed Basins
    for (const b of initialBasins) {
      await db
        .insert(basins)
        .values({
          ...b,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: basins.id,
          set: {
            nameTh: b.nameTh,
            nameEn: b.nameEn,
            isActive: b.isActive,
            updatedAt: now,
          },
        });
    }
    console.log(`✅ Seeded ${initialBasins.length} Basins`);

    // 2. Check if flood-analysis-model/dataset exists to auto-import rich station files and boundaries
    const modelDatasetDir = getModelDatasetDir();

    if (modelDatasetDir) {
      console.log(`📂 Found model dataset directory at ${modelDatasetDir}, importing stations and boundaries...`);
      const allowedBasinSlugs = new Set(initialBasins.map((b) => b.slug));
      const basinFolders = readdirSync(modelDatasetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && allowedBasinSlugs.has(d.name))
        .map((d) => d.name);

      for (const slug of basinFolders) {
        const stationDir = join(modelDatasetDir, slug, "station");
        const processedDir = join(modelDatasetDir, slug, "processed");
        const gisDir = join(modelDatasetDir, slug, "gis");

        // Waterlevel
        const wlFile = join(stationDir, `${slug}_waterlevel_stations.json`);
        if (existsSync(wlFile)) {
          const data = JSON.parse(readFileSync(wlFile, "utf-8"));
          await stationImporter.importWaterlevelStations(data, `${slug}_waterlevel_stations.json`, { skipR2: true });
        }

        // Rainfall
        const rainFile = join(stationDir, `${slug}_rain_stations.json`);
        if (existsSync(rainFile)) {
          const data = JSON.parse(readFileSync(rainFile, "utf-8"));
          await stationImporter.importRainfallStations(data, `${slug}_rain_stations.json`, { skipR2: true });
        }

        // Relations (Prioritize relations_frontend.json)
        const relFrontend = join(processedDir, "relations_frontend.json");
        const relWaterlevel = join(processedDir, "relation_waterlevel_frontend.json");
        const relFile = existsSync(relFrontend) ? relFrontend : existsSync(relWaterlevel) ? relWaterlevel : null;
        if (relFile) {
          const data = JSON.parse(readFileSync(relFile, "utf-8"));
          await stationImporter.importRelations(data, slug, { skipR2: true });
        }

        // Basin Boundary GeoJSON (_boundary.geojson)
        const boundaryCandidate = r2Publisher.getModelBoundaryPath(slug);
        if (boundaryCandidate && existsSync(boundaryCandidate)) {
          try {
            await r2Publisher.publishBasinBoundary(slug);
            console.log(`  -> Basin [${slug}] boundary GeoJSON uploaded & registered.`);
          } catch (bErr: any) {
            console.warn(`  ⚠️ Could not upload boundary for ${slug}:`, bErr.message);
          }
        }

        console.log(`  -> Basin [${slug}] stations, relations & boundary processed.`);
      }
      console.log("✅ Finished importing stations, relations, and boundaries from dataset folders");
    }

    console.log("🎉 Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  }
}

if (import.meta.main) {
  seedDatabase().then(() => process.exit(0));
}
