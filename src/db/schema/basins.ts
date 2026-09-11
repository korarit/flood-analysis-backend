import { boolean, doublePrecision, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const basins = pgTable("basins", {
  id: text("id").primaryKey(), // e.g. 'yom', 'ping', 'wang', 'nan', 'chi', 'mun'
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  code: varchar("code", { length: 16 }).notNull(),
  nameTh: varchar("name_th", { length: 255 }).notNull(),
  nameEn: varchar("name_en", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  descriptionTh: text("description_th"),
  descriptionEn: text("description_en"),
  areaKm2: doublePrecision("area_km2"),
  // Path to boundary GeoJSON on R2 / storage (e.g. 'basin/{slug}/spatial/boundary.geojson').
  // ค่า null หมายถึงยังไม่ได้ upload ไฟล์ GeoJSON ขอบเขตลุ่มน้ำ
  boundaryGeojsonPath: text("boundary_geojson_path"),
  // Path to flow paths compressed GeoJSON on R2 / storage (e.g. 'basin/{slug}/spatial/flow_paths.geojson.gz').
  // ค่า null หมายถึงยังไม่ได้ upload ไฟล์ GeoJSON โครงข่ายเส้นทางน้ำ
  flowPathsGeojsonPath: text("flow_paths_geojson_path"),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BasinRow = typeof basins.$inferSelect;
export type NewBasinRow = typeof basins.$inferInsert;
