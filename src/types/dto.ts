import { z } from "zod";

// ==========================================
// 1. Basin Management DTOs
// ==========================================

export const CreateBasinDto = z.object({
  slug: z
    .string()
    .min(1, "Basin slug is required")
    .regex(/^[a-z0-9-]+$/, "Slug must only contain lowercase letters, numbers, and hyphens"),
  code: z.string().min(1, "Basin code is required"),
  nameTh: z.string().min(1, "Thai name is required"),
  nameEn: z.string().min(1, "English name is required"),
  descriptionTh: z.string().optional().nullable(),
  descriptionEn: z.string().optional().nullable(),
  areaKm2: z.number().positive().optional().nullable(),
  isActive: z.boolean().default(true),
});

export type CreateBasinInput = z.infer<typeof CreateBasinDto>;

export const UpdateBasinDto = CreateBasinDto.partial();
export type UpdateBasinInput = z.infer<typeof UpdateBasinDto>;

// ==========================================
// 2. Station Item Common Structures
// ==========================================

const LocalizedNameDto = z.object({
  th: z.string().optional().nullable(),
  en: z.string().optional().nullable(),
}).passthrough().optional().nullable();

const AgencyDto = z.object({
  agency_name: LocalizedNameDto,
  agency_shortname: LocalizedNameDto,
  agency_code: z.string().optional().nullable(),
}).passthrough().optional().nullable();

const GeocodeDto = z.object({
  area_code: z.union([z.string(), z.number()]).optional().nullable(),
  area_name: LocalizedNameDto,
  amphoe_name: LocalizedNameDto,
  tumbon_name: LocalizedNameDto,
  province_code: z.union([z.string(), z.number()]).optional().nullable(),
  province_name: LocalizedNameDto,
  geo_code: z.union([z.string(), z.number()]).optional().nullable(),
  rid_code: z.union([z.string(), z.number()]).optional().nullable(),
  tmd_code: z.union([z.string(), z.number()]).optional().nullable(),
}).passthrough().optional().nullable();

// ==========================================
// 3. Waterlevel Station DTO
// ==========================================

export const WaterlevelStationItemDto = z.object({
  station: z.object({
    id: z.union([z.string(), z.number()], {
      required_error: "station.id is required",
    }),
    tele_station_name: LocalizedNameDto,
    tele_station_lat: z.union([z.number(), z.string()]).optional().nullable(),
    tele_station_long: z.union([z.number(), z.string()]).optional().nullable(),
    tele_station_oldcode: z.string().optional().nullable(),
    tele_station_type: z.string().optional().nullable(),
    ground_level: z.union([z.number(), z.string()]).optional().nullable(),
    min_bank: z.union([z.number(), z.string()]).optional().nullable(),
    qmax: z.union([z.number(), z.string()]).optional().nullable(),
    river_name: z.string().optional().nullable(),
    sponsor_by: z.string().optional().nullable(),
  }).passthrough(),
  agency: AgencyDto,
  geocode: GeocodeDto,
  basin: z.any().optional(),
}).passthrough();

export const WaterlevelStationArrayDto = z
  .array(WaterlevelStationItemDto, {
    required_error: "Payload must be a JSON array of waterlevel stations",
  })
  .min(1, "Array must contain at least one station");

export type WaterlevelStationItem = z.infer<typeof WaterlevelStationItemDto>;

// ==========================================
// 4. Rainfall Station DTO
// ==========================================

export const RainfallStationItemDto = z.object({
  station: z.object({
    id: z.union([z.string(), z.number()], {
      required_error: "station.id is required",
    }),
    tele_station_name: LocalizedNameDto,
    tele_station_lat: z.union([z.number(), z.string()]).optional().nullable(),
    tele_station_long: z.union([z.number(), z.string()]).optional().nullable(),
    tele_station_oldcode: z.string().optional().nullable(),
    tele_station_type: z.string().optional().nullable(),
  }).passthrough(),
  agency: AgencyDto,
  geocode: GeocodeDto,
  basin: z.any().optional(),
}).passthrough();

export const RainfallStationArrayDto = z
  .array(RainfallStationItemDto, {
    required_error: "Payload must be a JSON array of rainfall stations",
  })
  .min(1, "Array must contain at least one station");

export type RainfallStationItem = z.infer<typeof RainfallStationItemDto>;
