import { bigserial, boolean, doublePrecision, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { stations } from "./stations";

export const stationRelations = pgTable(
  "station_relations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stationId: varchar("station_id", { length: 64 })
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    targetStationId: varchar("target_station_id", { length: 64 })
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    relationType: varchar("relation_type", { length: 32 }).notNull(), // 'rainfall_influence' | 'downstream_gauge' | 'tributary'
    distanceKm: doublePrecision("distance_km"), // Distance in km
    travelTimeHours: doublePrecision("travel_time_hours"), // Model computed travel time in hours
    travelTimeHoursMin: doublePrecision("travel_time_hours_min"),
    travelTimeHoursMax: doublePrecision("travel_time_hours_max"),
    influenceWeightPercent: doublePrecision("influence_weight_percent"), // % e.g. 45
    isUpstream: boolean("is_upstream").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stationRelationIdx: index("idx_station_relations_station_target").on(table.stationId, table.targetStationId),
  })
);

export type StationRelationRow = typeof stationRelations.$inferSelect;
export type NewStationRelationRow = typeof stationRelations.$inferInsert;
