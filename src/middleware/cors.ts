import { cors } from "hono/cors";
import { env } from "../config/env";

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return "*";
    const allowed = env.CORS_ORIGINS.split(",").map((o) => o.trim());
    if (allowed.includes("*") || allowed.includes(origin)) {
      return origin;
    }
    return origin; // Allow origin for local development
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
  allowHeaders: ["Content-Type", "Authorization", "x-cron-secret", "x-api-key"],
  maxAge: 86400,
});
