import { bigserial, doublePrecision, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { stations } from "./stations";

export const telemetryLatest = pgTable("telemetry_latest", {
  stationId: varchar("station_id", { length: 64 })
    .primaryKey()
    .references(() => stations.id, { onDelete: "cascade" }),
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
  alertReasonTh: text("alert_reason_th"), // ข้อความเตือนภัยและสาเหตุ (เช่น มีฝนตกหนักที่ต้นน้ำ)
  alertReasonEn: text("alert_reason_en"), // Warning reason in English
  isUpstreamAlert: text("is_upstream_alert"), // 'true' | 'false' / flag
  estimatedArrivalHoursMin: doublePrecision("estimated_arrival_hours_min"), // Model computed min arrival time
  estimatedArrivalHoursMax: doublePrecision("estimated_arrival_hours_max"), // Model computed max arrival time
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const telemetryHistory = pgTable(
  "telemetry_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stationId: varchar("station_id", { length: 64 })
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    stage: doublePrecision("stage"),
    discharge: doublePrecision("discharge"),
    waterLevelMsl: doublePrecision("water_level_msl"),
    rainfallValue: doublePrecision("rainfall_value"),
    rainfallPeriod: varchar("rainfall_period", { length: 16 }), // '15m' | '1h' | '24h'
    dataStatus: varchar("data_status", { length: 32 }).default("valid").notNull(), // 'valid' | 'suspect' | 'missing'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stationTimeIdx: index("idx_telemetry_history_station_time").on(table.stationId, table.timestamp),
  })
);

export type TelemetryLatestRow = typeof telemetryLatest.$inferSelect;
export type NewTelemetryLatestRow = typeof telemetryLatest.$inferInsert;
export type TelemetryHistoryRow = typeof telemetryHistory.$inferSelect;
export type NewTelemetryHistoryRow = typeof telemetryHistory.$inferInsert;
