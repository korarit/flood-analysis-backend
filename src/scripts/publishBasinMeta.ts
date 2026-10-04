import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins } from "../db/schema";
import { ensureBasinsInDb } from "../config/basins";
import { r2Publisher } from "../services/r2PublisherService";

/**
 * CLI Runner for Publishing Basin Metadata (/basin/{slug}/basin.json) and Root /basins.json
 * Usage:
 *   bun run sync:basin           # Publish all active basins metadata
 *   bun run sync:basin yom       # Publish specific basin metadata
 *   bun run sync:basin --basin=bang-pakong
 *   bun run upload:basin         # Alias
 */
async function main() {
  const args = process.argv.slice(2);
  let targetSlug: string | undefined = undefined;

  for (const arg of args) {
    if (arg.startsWith("--basin=")) {
      const val = arg.split("=")[1]?.trim();
      targetSlug = val?.toLowerCase() === "all" ? undefined : val;
    } else if (arg === "--all" || arg.toLowerCase() === "all") {
      targetSlug = undefined;
    } else if (!arg.startsWith("--")) {
      const val = arg.trim();
      targetSlug = val.toLowerCase() === "all" ? undefined : val;
    }
  }

  console.log("===============================================================");
  console.log("🌊 WATER SITUATION PLATFORM — BASIN METADATA PUBLISHER");
  console.log("===============================================================");
  console.log(`🎯 Target: ${targetSlug ? `Basin '${targetSlug}'` : "All Basins"}\n`);

  await ensureBasinsInDb(targetSlug ? [targetSlug] : undefined);

  if (targetSlug && targetSlug !== "all") {
    const [b] = await db.select().from(basins).where(eq(basins.slug, targetSlug));
    if (!b) {
      console.error(`❌ Error: Basin '${targetSlug}' not found in PostgreSQL!`);
      const all = await db.select({ slug: basins.slug }).from(basins);
      console.log("Available basins:", all.map((x) => x.slug).join(", "));
      process.exit(1);
    }
    console.log(`🎯 Target Basin: ${b.nameTh} (${b.slug})`);
    const res = await r2Publisher.publishBasinMetadata(b.slug);
    console.log(`✅ Successfully published metadata to ${res.url}`);
    await r2Publisher.publishBasinOverview(b.slug);
    await r2Publisher.publishBasinStationsList(b.slug);
    console.log(`✅ Successfully published overview.json and stations.json for ${b.slug}`);
  } else {
    const allBasins = await db.select().from(basins).where(eq(basins.isActive, true));
    console.log(`🎯 Publishing metadata, overview, and stations list for all ${allBasins.length} active basins...`);
    for (const b of allBasins) {
      const res = await r2Publisher.publishBasinMetadata(b.slug);
      await r2Publisher.publishBasinOverview(b.slug);
      await r2Publisher.publishBasinStationsList(b.slug);
      console.log(`  ✅ [${b.slug}] ${res.url}`);
    }
    console.log("\n📦 Updating root /basins.json...");
    const rootRes = await r2Publisher.publishBasinsList();
    console.log(`  ✅ [root] ${rootRes.url}`);
  }

  console.log("===============================================================");
  console.log("🎉 BASIN METADATA UPDATE COMPLETED SUCCESSFULLY!");
  console.log("===============================================================\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Fatal error publishing basin metadata:", err);
  process.exit(1);
});
