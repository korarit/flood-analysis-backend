import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 64 }).notNull(), // 'sync_all' | 'sync_telemetry' | 'sync_stations' | 'publish_r2'
  basinId: text("basin_id"),
  status: varchar("status", { length: 32 }).notNull(), // 'running' | 'completed' | 'failed'
  recordsProcessed: integer("records_processed").default(0).notNull(),
  errors: jsonb("errors"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert;
