import { eq } from "drizzle-orm";
import { db } from "../db";
import { basins } from "../db/schema";
import { r2Publisher } from "../services/r2PublisherService";

/**
 * CLI Runner for Publishing Basin Metadata (/basin/{slug}/basin.json) and Root /basins.json
 * Usage:
 *   bun run sync:basin           # Publish all active basins metadata
 *   bun run sync:basin yom       # Publish specific basin metadata
 *   bun run upload:basin         # Alias
 */
async function main() {
  const targetSlug = process.argv[2]?.trim().toLowerCase();

  console.log("===============================================================");
  console.log("🌊 WATER SITUATION PLATFORM — BASIN METADATA PUBLISHER");
  console.log("===============================================================");

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
  } else {
    const allBasins = await db.select().from(basins).where(eq(basins.isActive, true));
    console.log(`🎯 Publishing metadata for all ${allBasins.length} active basins...`);
    for (const b of allBasins) {
      const res = await r2Publisher.publishBasinMetadata(b.slug);
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
