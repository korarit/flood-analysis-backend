import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3001").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_BASE_URL: z.string().default("http://localhost:3001"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"),

  // Database
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/water_analysis"),

  // External Cron Secret
  CRON_SECRET: z.string().default("water_analysis_cron_secret_key_2026"),

  // ThaiWater Platform API Configuration
  THAIWATER_API_BASE_URL: z.string().default("https://twa-api-public.thaiwater.net"),
  THAIWATER_API_KEY: z.string().default("TPSXrHRvTHeVT2Lygq6YeTqqAm4xZ72x"),
  THAIWATER_ORIGIN: z.string().default("https://twa.thaiwater.net"),
  THAIWATER_REFERER: z.string().default("https://twa.thaiwater.net/"),
  THAIWATER_INGESTION_MODE: z.enum(["bulk", "legacy"]).default("bulk"),

  // Cloudflare R2 Object Storage
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET_NAME: z.string().default("water-analysis-public"),
  R2_PUBLIC_BASE_URL: z.string().default("http://localhost:3001/r2-static"),
  R2_CUSTOM_ENDPOINT: z.string().optional().default(""),
  R2_LOCAL_FALLBACK: z.string().default("true").transform((v) => v === "true" || v === "1"),

  // Model Dataset Directory (configurable path for local station/boundary ingestion)
  MODEL_DATASET_DIR: z.string().optional().default(""),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
