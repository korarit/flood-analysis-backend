import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { env } from "../config/env";
import { hasR2Credentials, r2Client } from "../config/r2";
import { db } from "../db";

const healthRouter = new Hono();

healthRouter.get("/", async (c) => {
  const startTime = Date.now();
  let dbStatus = "ok";
  let r2Status = hasR2Credentials() ? "configured" : "local_fallback";

  // Check Database connection
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err: any) {
    dbStatus = `error: ${err.message}`;
  }

  const memory = process.memoryUsage();

  return c.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: env.NODE_ENV,
    checks: {
      database: dbStatus,
      r2Storage: r2Status,
      thaiWaterApi: "ready",
    },
    system: {
      rssMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    },
    latencyMs: Date.now() - startTime,
  });
});

export { healthRouter };
