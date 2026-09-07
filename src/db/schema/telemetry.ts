import { doublePrecision, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const telemetryLatest = pgTable("telemetry_latest", {
  stationId: varchar("station_id", { length: 64 }).primaryKey(),
  basinId: text("basin_id").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  stage: doublePrecision("stage"), // meters
  discharge: doublePrecision("discharge"), // cms (m3/s)
  waterLevelMsl: doublePrecision("water_level_msl"), // m MSL
  storagePercent: doublePrecision("storage_percent"), // %
  rainfall1h: doublePrecision("rainfall_1h"), // mm
  rainfall3h: doublePrecision("rainfall_3h"), // mm
  rainfall6h: doublePrecision("rainfall_6h"), // mm
  rainfall24h: doublePrecision("rainfall_24h"), // mm
  rainfallToday: doublePrecision("rainfall_today"), // mm
  trend: varchar("trend", { length: 32 }), // 'rising' | 'steady' | 'falling'
  situationStatus: varchar("situation_status", { length: 32 }).default("normal").notNull(), // 'normal' | 'watch' | 'warning' | 'critical' | 'missing'
  freshnessStatus: varchar("freshness_status", { length: 32 }).default("fresh").notNull(), // 'fresh' | 'delayed' | 'missing'
  alertReasonTh: text("alert_reason_th"),
  alertReasonEn: text("alert_reason_en"),
  isUpstreamAlert: text("is_upstream_alert"),
  estimatedArrivalHoursMin: doublePrecision("estimated_arrival_hours_min"),
  estimatedArrivalHoursMax: doublePrecision("estimated_arrival_hours_max"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TelemetryLatestRow = typeof telemetryLatest.$inferSelect;
export type NewTelemetryLatestRow = typeof telemetryLatest.$inferInsert;
