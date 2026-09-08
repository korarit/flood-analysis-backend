import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./config/env";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import { adminRouter } from "./routes/admin";
import { basinsRouter } from "./routes/basins";
import { cronRouter } from "./routes/cron";
import { healthRouter } from "./routes/health";
import { stationsRouter } from "./routes/stations";

const app = new Hono();

// Global Middlewares
app.use("*", corsMiddleware);
app.onError(errorHandler);

// Root Welcome Route
app.get("/", (c) => {
  return c.json({
    name: "Water Situation Platform Backend",
    version: "1.0.0",
    docs: {
      architecture: "One Platform + One Backend + Multiple Basins + Public R2 Datasets + REST API",
      health: "/health",
      basins: "/api/basins",
      stations: "/api/stations",
      cron: "/api/cron/*",
      admin: "/api/admin/*",
      r2StaticMock: "/r2-static/*",
    },
    status: "running",
  });
});

// Mount Routes
app.route("/health", healthRouter);
app.route("/api/health", healthRouter);
app.route("/api/basins", basinsRouter);
app.route("/api/stations", stationsRouter);
app.route("/api/cron", cronRouter);
app.route("/api/admin", adminRouter);

// Local R2 Static File Mirror Handler (for testing R2 Datasets locally)
app.get("/r2-static/*", (c) => {
  const filePath = c.req.path.replace(/^\/r2-static\//, "");
  const localFile = join(process.cwd(), ".r2-local", filePath);

  if (existsSync(localFile)) {
    if (filePath.endsWith(".gz")) {
      const buffer = readFileSync(localFile);
      return c.body(buffer, 200, {
        "Content-Type": "application/gzip",
        "Cache-Control": "public, max-age=604800",
      });
    }
    const isGeoJson = filePath.endsWith(".geojson");
    const content = readFileSync(localFile, "utf-8");
    return c.text(content, 200, {
      "Content-Type": isGeoJson ? "application/geo+json; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    });
  }

  return c.json(
    {
      error: "NoSuchKey",
      message: `Object '${filePath}' not found in R2 local storage mirror`,
    },
    404
  );
});

console.log(`🌊 Water Situation Backend running at http://localhost:${env.PORT}`);

export { app };

export default {
  port: env.PORT,
  fetch: app.fetch,
};
