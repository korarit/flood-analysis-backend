import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const datasetRegistry = pgTable("dataset_registry", {
  id: serial("id").primaryKey(),
  basinId: text("basin_id"),
  datasetType: varchar("dataset_type", { length: 64 }).notNull(), // 'basins', 'overview', 'stations', 'current', 'history', 'spatial'
  r2Path: varchar("r2_path", { length: 512 }).notNull().unique(),
  schemaVersion: varchar("schema_version", { length: 32 }).default("1.0").notNull(),
  datasetVersion: varchar("dataset_version", { length: 64 }),
  etag: varchar("etag", { length: 128 }),
  status: varchar("status", { length: 32 }).default("published").notNull(), // 'published' | 'building' | 'failed'
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DatasetRegistryRow = typeof datasetRegistry.$inferSelect;
export type NewDatasetRegistryRow = typeof datasetRegistry.$inferInsert;
