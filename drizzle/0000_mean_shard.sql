CREATE TABLE "basins" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"code" varchar(16) NOT NULL,
	"name_th" varchar(255) NOT NULL,
	"name_en" varchar(255) NOT NULL,
	"description_th" text,
	"description_en" text,
	"area_km2" double precision,
	"boundary_bbox" jsonb,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "basins_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(64),
	"basin_id" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"name_th" varchar(255) NOT NULL,
	"name_en" varchar(255) NOT NULL,
	"address_th" text,
	"address_en" text,
	"agency_name_th" varchar(255),
	"agency_name_en" varchar(255),
	"river_name_th" varchar(255),
	"river_name_en" varchar(255),
	"ground_level_msl" double precision,
	"bank_level_msl" double precision,
	"warning_level_msl" double precision,
	"critical_level_msl" double precision,
	"warning_rain_24h" double precision,
	"critical_rain_24h" double precision,
	"source" varchar(64) DEFAULT 'thaiwater' NOT NULL,
	"source_station_id" varchar(64),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"station_id" varchar(64) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"stage" double precision,
	"discharge" double precision,
	"water_level_msl" double precision,
	"rainfall_value" double precision,
	"rainfall_period" varchar(16),
	"data_status" varchar(32) DEFAULT 'valid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_latest" (
	"station_id" varchar(64) PRIMARY KEY NOT NULL,
	"basin_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"stage" double precision,
	"discharge" double precision,
	"water_level_msl" double precision,
	"storage_percent" double precision,
	"rainfall_1h" double precision,
	"rainfall_24h" double precision,
	"rainfall_today" double precision,
	"trend" varchar(32),
	"situation_status" varchar(32) DEFAULT 'normal' NOT NULL,
	"freshness_status" varchar(32) DEFAULT 'fresh' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"basin_id" text,
	"dataset_type" varchar(64) NOT NULL,
	"r2_path" varchar(512) NOT NULL,
	"schema_version" varchar(32) DEFAULT '1.0' NOT NULL,
	"dataset_version" varchar(64),
	"etag" varchar(128),
	"status" varchar(32) DEFAULT 'published' NOT NULL,
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_registry_r2_path_unique" UNIQUE("r2_path")
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(64) NOT NULL,
	"basin_id" text,
	"status" varchar(32) NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_basin_id_basins_id_fk" FOREIGN KEY ("basin_id") REFERENCES "public"."basins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_history" ADD CONSTRAINT "telemetry_history_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_latest" ADD CONSTRAINT "telemetry_latest_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_telemetry_history_station_time" ON "telemetry_history" USING btree ("station_id","timestamp");