/**
 * uploadRelations.ts
 * -------------------
 * Uploads relation_waterlevel_frontend.json (or relations_frontend.json) for each basin
 * from the model dataset directory, then rebuilds river/chain.json via r2Publisher.
 *
 * Run: bun run src/scripts/uploadRelations.ts
 * Options:
 *   --basin=nan        (process a single basin only)
 *   --dry-run          (print what would be uploaded without actually doing it)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getModelDatasetDir } from "../config/paths";
import { r2Publisher } from "../services/r2PublisherService";
import { stationImporter } from "../services/stationImporterService";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const targetBasin = args.find((a) => a.startsWith("--basin="))?.split("=")[1] ?? null;
const isDryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("🌊 uploadRelations — basin relation data uploader");
  console.log("=".repeat(60));
  if (isDryRun) console.log("🔍 DRY-RUN mode — no changes will be written\n");

  const modelDir = getModelDatasetDir();
  if (!modelDir || !existsSync(modelDir)) {
    console.error("❌ Model dataset directory not found or not configured (MODEL_DATASET_DIR).");
    console.error("   Set MODEL_DATASET_DIR in .env to point to flood-analysis-model/dataset");
    process.exit(1);
  }

  console.log(`📂 Model dataset dir: ${modelDir}\n`);

  // Discover basin folders
  const allBasinFolders = readdirSync(modelDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const basinFolders = targetBasin
    ? allBasinFolders.filter((slug) => slug === targetBasin)
    : allBasinFolders;

  if (basinFolders.length === 0) {
    console.error(`❌ No basin folders found${targetBasin ? ` matching '${targetBasin}'` : ""}`);
    process.exit(1);
  }

  console.log(`📋 Processing ${basinFolders.length} basin(s): ${basinFolders.join(", ")}\n`);

  const results: Array<{
    basin: string;
    file: string;
    status: "ok" | "skipped" | "error";
    inserted?: number;
    chainRebuilt?: boolean;
    error?: string;
  }> = [];

  for (const slug of basinFolders) {
    const processedDir = join(modelDir, slug, "processed");

    // Prefer relations_frontend.json (full), fallback to relation_waterlevel_frontend.json
    const relFrontend = join(processedDir, "relations_frontend.json");
    const relWaterlevel = join(processedDir, "relation_waterlevel_frontend.json");
    const targetFile = existsSync(relFrontend)
      ? relFrontend
      : existsSync(relWaterlevel)
      ? relWaterlevel
      : null;

    if (!targetFile) {
      console.log(`⚪ [${slug}] No relation file found in ${processedDir} — skipping`);
      results.push({ basin: slug, file: "-", status: "skipped" });
      continue;
    }

    const relFileName = basename(targetFile);
    console.log(`🔗 [${slug}] Found: ${relFileName}`);

    if (isDryRun) {
      const data = JSON.parse(readFileSync(targetFile, "utf-8"));
      console.log(`   DRY-RUN: would upload ${Array.isArray(data) ? data.length : "?"} relation entries`);
      results.push({ basin: slug, file: relFileName, status: "ok" });
      continue;
    }

    try {
      // 1. Parse relation file
      const data = JSON.parse(readFileSync(targetFile, "utf-8"));
      if (!Array.isArray(data)) {
        throw new Error("File is not a JSON array");
      }

      console.log(`   📤 Importing ${data.length} relation entries...`);

      // 2. Import relations into DB + publish individual station relations.json to R2
      const importResult = await stationImporter.importRelations(data, slug);
      console.log(`   ✅ Imported: ${importResult.inserted} edges | Errors: ${importResult.errors.length}`);
      if (importResult.errors.length > 0) {
        console.warn(`   ⚠️  Errors:`, importResult.errors.slice(0, 3));
      }

      // 3. Rebuild river/chain.json with topological order
      let chainRebuilt = false;
      try {
        console.log(`   🔄 Rebuilding river/chain.json (topological sort)...`);
        await r2Publisher.publishSpatialAndReports(slug);
        chainRebuilt = true;
        console.log(`   ✅ river/chain.json rebuilt successfully`);
      } catch (chainErr: any) {
        console.warn(`   ⚠️  chain.json rebuild warning: ${chainErr.message}`);
      }

      results.push({
        basin: slug,
        file: relFileName,
        status: "ok",
        inserted: importResult.inserted,
        chainRebuilt,
      });
    } catch (err: any) {
      console.error(`   ❌ Error processing [${slug}]: ${err.message}`);
      results.push({ basin: slug, file: relFileName, status: "error", error: err.message });
    }

    console.log();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary:");
  console.log("-".repeat(60));

  const ok = results.filter((r) => r.status === "ok");
  const skipped = results.filter((r) => r.status === "skipped");
  const errored = results.filter((r) => r.status === "error");

  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "skipped" ? "⚪" : "❌";
    const detail = r.status === "ok"
      ? `${r.inserted ?? 0} edges | chain: ${r.chainRebuilt ? "rebuilt" : "skipped"}`
      : r.status === "error"
      ? r.error
      : "no file";
    console.log(`  ${icon} ${r.basin.padEnd(16)} ${detail}`);
  }

  console.log("-".repeat(60));
  console.log(`  ✅ Success: ${ok.length} | ⚪ Skipped: ${skipped.length} | ❌ Errors: ${errored.length}`);
  console.log("=".repeat(60));

  if (errored.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
