import { doublePrecision, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { basins } from "./basins";

/**
 * Waterlevel Stations Schema
 * Matched directly from *_waterlevel_stations.json structure
 */
export const waterlevelStations = pgTable("waterlevel_stations", {
  id: varchar("id", { length: 64 }).primaryKey(), // station.id
  basinId: text("basin_id")
    .notNull()
    .references(() => basins.id, { onDelete: "cascade" }),
  oldcode: varchar("oldcode", { length: 64 }),
  stationType: varchar("station_type", { length: 64 }).default("waterlevel").notNull(),
  nameTh: varchar("name_th", { length: 255 }).notNull(),
  nameEn: varchar("name_en", { length: 255 }).notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  groundLevel: doublePrecision("ground_level"), // MSL
  minBank: doublePrecision("min_bank"), // Bank level MSL
  qmax: doublePrecision("qmax"), // Max discharge m3/s
  riverName: varchar("river_name", { length: 255 }),
  sponsorBy: text("sponsor_by"),

  // Agency
  agencyNameTh: varchar("agency_name_th", { length: 255 }),
  agencyNameEn: varchar("agency_name_en", { length: 255 }),
  agencyShortnameTh: varchar("agency_shortname_th", { length: 64 }),
  agencyShortnameEn: varchar("agency_shortname_en", { length: 64 }),
  agencyCode: varchar("agency_code", { length: 64 }),

  // Geocode
  areaCode: varchar("area_code", { length: 32 }),
  areaNameTh: varchar("area_name_th", { length: 128 }),
  areaNameEn: varchar("area_name_en", { length: 128 }),
  amphoeNameTh: varchar("amphoe_name_th", { length: 128 }),
  amphoeNameEn: varchar("amphoe_name_en", { length: 128 }),
  tumbonNameTh: varchar("tumbon_name_th", { length: 128 }),
  tumbonNameEn: varchar("tumbon_name_en", { length: 128 }),
  provinceCode: varchar("province_code", { length: 32 }),
  provinceNameTh: varchar("province_name_th", { length: 128 }),
  provinceNameEn: varchar("province_name_en", { length: 128 }),
  geoCode: varchar("geo_code", { length: 64 }),
  ridCode: varchar("rid_code", { length: 64 }),
  tmdCode: varchar("tmd_code", { length: 64 }),

  // Status & Raw Metadata
  status: varchar("status", { length: 32 }).default("active").notNull(),
  rawMetadata: jsonb("raw_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Rainfall Stations Schema
 * Matched directly from *_rain_stations.json structure
 */
export const rainfallStations = pgTable("rainfall_stations", {
  id: varchar("id", { length: 64 }).primaryKey(), // station.id
  basinId: text("basin_id")
    .notNull()
    .references(() => basins.id, { onDelete: "cascade" }),
  oldcode: varchar("oldcode", { length: 64 }),
  stationType: varchar("station_type", { length: 64 }).default("rainfall_24h").notNull(),
  subBasinId: varchar("sub_basin_id", { length: 64 }),
  subBasinName: varchar("sub_basin_name", { length: 255 }),
  sponsorBy: text("sponsor_by"),
  nameTh: varchar("name_th", { length: 255 }).notNull(),
  nameEn: varchar("name_en", { length: 255 }).notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  warningZone: varchar("warning_zone", { length: 64 }),
  warningRain24h: doublePrecision("warning_rain_24h").default(35),
  criticalRain24h: doublePrecision("critical_rain_24h").default(90),

  // Agency
  agencyNameTh: varchar("agency_name_th", { length: 255 }),
  agencyNameEn: varchar("agency_name_en", { length: 255 }),
  agencyShortnameTh: varchar("agency_shortname_th", { length: 64 }),
  agencyShortnameEn: varchar("agency_shortname_en", { length: 64 }),

  // Geocode
  areaCode: varchar("area_code", { length: 32 }),
  areaNameTh: varchar("area_name_th", { length: 128 }),
  areaNameEn: varchar("area_name_en", { length: 128 }),
  amphoeNameTh: varchar("amphoe_name_th", { length: 128 }),
  amphoeNameEn: varchar("amphoe_name_en", { length: 128 }),
  tumbonNameTh: varchar("tumbon_name_th", { length: 128 }),
  tumbonNameEn: varchar("tumbon_name_en", { length: 128 }),
  provinceCode: varchar("province_code", { length: 32 }),
  provinceNameTh: varchar("province_name_th", { length: 128 }),
  provinceNameEn: varchar("province_name_en", { length: 128 }),

  // Status & Raw Metadata
  status: varchar("status", { length: 32 }).default("active").notNull(),
  rawMetadata: jsonb("raw_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WaterlevelStationRow = typeof waterlevelStations.$inferSelect;
export type NewWaterlevelStationRow = typeof waterlevelStations.$inferInsert;
export type RainfallStationRow = typeof rainfallStations.$inferSelect;
export type NewRainfallStationRow = typeof rainfallStations.$inferInsert;
