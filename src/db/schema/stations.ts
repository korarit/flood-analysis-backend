import { doublePrecision, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { basins } from "./basins";

export const stations = pgTable("stations", {
  id: varchar("id", { length: 64 }).primaryKey(), // e.g. 'Y-0014' or '8892'
  code: varchar("code", { length: 64 }),
  basinId: text("basin_id")
    .notNull()
    .references(() => basins.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 32 }).notNull(), // 'water_level' | 'rainfall'
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  nameTh: varchar("name_th", { length: 255 }).notNull(),
  nameEn: varchar("name_en", { length: 255 }).notNull(),
  addressTh: text("address_th"),
  addressEn: text("address_en"),
  agencyNameTh: varchar("agency_name_th", { length: 255 }),
  agencyNameEn: varchar("agency_name_en", { length: 255 }),
  riverNameTh: varchar("river_name_th", { length: 255 }),
  riverNameEn: varchar("river_name_en", { length: 255 }),
  groundLevelMsl: doublePrecision("ground_level_msl"),
  bankLevelMsl: doublePrecision("bank_level_msl"),
  warningLevelMsl: doublePrecision("warning_level_msl"),
  criticalLevelMsl: doublePrecision("critical_level_msl"),
  warningRain24h: doublePrecision("warning_rain_24h"),
  criticalRain24h: doublePrecision("critical_rain_24h"),
  lagTimeHours: doublePrecision("lag_time_hours"), // Model-computed runoff travel time (hours)
  lagTimeHoursMin: doublePrecision("lag_time_hours_min"), // Model-computed minimum arrival hours
  lagTimeHoursMax: doublePrecision("lag_time_hours_max"), // Model-computed maximum arrival hours
  source: varchar("source", { length: 64 }).default("thaiwater").notNull(),
  sourceStationId: varchar("source_station_id", { length: 64 }),
  status: varchar("status", { length: 32 }).default("active").notNull(), // 'active' | 'inactive' | 'unknown'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StationRow = typeof stations.$inferSelect;
export type NewStationRow = typeof stations.$inferInsert;
