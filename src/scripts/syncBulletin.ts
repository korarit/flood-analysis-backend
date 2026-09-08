import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { basins } from "../db/schema";
import { llmBulletinService } from "../services/llmBulletinService";

/**
 * CLI Runner for LLM Hydrological Situation Bulletin Generation
 * Usage:
 *   bun run llm:sync                  # Generate bulletins for all active basins
 *   bun run llm:sync yom              # Generate bulletin for specific basin by slug
 *   bun run llm:sync --basin=yom      # Generate bulletin for specific basin with flag
 *   npm run llm:sync                  # Alias runnable via npm
 */
async function run() {
  const args = process.argv.slice(2);
  let targetBasin: string | undefined = undefined;

  for (const arg of args) {
    if (arg.startsWith("--basin=")) {
      const val = arg.split("=")[1]?.trim();
      targetBasin = val?.toLowerCase() === "all" ? undefined : val;
    } else if (arg === "--all" || arg.toLowerCase() === "all") {
      targetBasin = undefined;
    } else if (!arg.startsWith("--")) {
      const val = arg.trim();
      targetBasin = val.toLowerCase() === "all" ? undefined : val;
    }
  }

  const startTime = new Date();
  console.log("===============================================================");
  console.log("🌊 WATER SITUATION PLATFORM — LLM HYDROLOGICAL BULLETIN SYNC");
  console.log("===============================================================");
  console.log(`⏰ Started at:       ${startTime.toLocaleString("th-TH")}`);
  console.log(`🎯 Target Basin:     ${targetBasin || "All Active Basins"}`);
  console.log(`🤖 AI Engine:        ${process.env.OPENAI_API_KEY ? "OpenAI Function Calling (gpt-4o-mini)" : "Smart Rule-Based Hydrological Synthesis"}`);
  console.log("---------------------------------------------------------------\n");

  // Validate basin if provided
  if (targetBasin) {
    const existing = await db.select().from(basins).where(eq(basins.slug, targetBasin)).limit(1);
    if (!existing.length) {
      console.error(`❌ Error: Basin '${targetBasin}' not found in database!`);
      const allBasins = await db.select({ slug: basins.slug, name: basins.nameTh }).from(basins);
      console.log("Available basins:", allBasins.map((b) => `${b.slug} (${b.name})`).join(", "));
      process.exit(1);
    }
  }

  try {
    const res = await llmBulletinService.generateAllBulletins(targetBasin);

    const endTime = new Date();
    const durationSec = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2);

    console.log("\n===============================================================");
    console.log("🎉 LLM BULLETIN GENERATION COMPLETED SUCCESSFULLY!");
    console.log("===============================================================");
    console.log(`⏱️ Duration:            ${durationSec} seconds`);
    console.log(`📊 Basins Processed:    ${res.generated} / ${res.total}`);
    console.log("\nGenerated Bulletins on Cloudflare R2:");
    for (const b of res.bulletins) {
      const publicUrl = `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/basin/${b.basinId}/report/bulletin-latest.json`;
      console.log(`   - [${b.overallSeverity.toUpperCase()}] ${b.basinName.th} (${b.basinId}):`);
      console.log(`     URL: ${publicUrl}`);
      console.log(`     Summary: ${b.overallSituation.th}`);
    }
    console.log("===============================================================\n");

    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ LLM Bulletin sync failed:", err.message);
    process.exit(1);
  }
}

run();
