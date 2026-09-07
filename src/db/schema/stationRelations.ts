import { bigserial, doublePrecision, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const stationRelations = pgTable(
  "station_relations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stationId: varchar("station_id", { length: 64 }).notNull(),
    targetStationId: varchar("target_station_id", { length: 64 }).notNull(),
    relationType: varchar("relation_type", { length: 32 }).notNull(), // 'downstream' | 'influencing'
    distanceKm: doublePrecision("distance_km"),
    travelTimeHours: doublePrecision("travel_time_hours"),
    travelTimeMinutes: doublePrecision("travel_time_minutes"),
    travelTimeHoursMin: doublePrecision("travel_time_hours_min"),
    travelTimeHoursMax: doublePrecision("travel_time_hours_max"),
    travelTimeMinutesMin: doublePrecision("travel_time_minutes_min"),
    travelTimeMinutesMax: doublePrecision("travel_time_minutes_max"),
    riverSlope: doublePrecision("river_slope"),
    elevationDiffM: doublePrecision("elevation_diff_m"),
    confidence: varchar("confidence", { length: 32 }), // 'HIGH' | 'MEDIUM' | 'LOW'
    responseType: varchar("response_type", { length: 64 }), // 'ESTIMATED' | 'OBSERVED'
    notes: text("notes"),
    rawMetadata: jsonb("raw_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stationRelationIdx: index("idx_station_relations_station_target").on(table.stationId, table.targetStationId),
    stationIdIdx: index("idx_station_relations_station_id").on(table.stationId),
  })
);

export type StationRelationRow = typeof stationRelations.$inferSelect;
export type NewStationRelationRow = typeof stationRelations.$inferInsert;
