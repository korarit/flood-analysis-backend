import { LocalizedString } from "./common";

export type StationType = "water_level" | "rainfall";
export type SituationStatus = "normal" | "watch" | "warning" | "critical" | "missing";
export type TrendDirection = "rising" | "steady" | "falling";
export type RainIntensity = "light" | "moderate" | "heavy" | "very_heavy";
export type FreshnessStatus = "fresh" | "delayed" | "missing";
export type DataStatus = "valid" | "suspect" | "missing";

export interface StationLocation {
  lat: number;
  lon: number;
  groundLevelMsl?: number | null;
  bankLevelMsl?: number | null;
  warningLevelMsl?: number | null;
  criticalLevelMsl?: number | null;
}

export interface StationThresholds {
  groundLevelMsl?: number | null;
  bedLevelMsl?: number | null;
  bankLevelMsl?: number | null;
  warningLevelMsl?: number | null;
  criticalLevelMsl?: number | null;
  warningRain24h?: number | null;
  criticalRain24h?: number | null;
}

export interface StationTelemetrySummary {
  stage?: number | null;
  discharge?: number | null;
  rainfall1h?: number | null;
  rainfall3h?: number | null;
  rainfall6h?: number | null;
  rainfall24h?: number | null;
  rainfallToday?: number | null;
  waterLevelMsl?: number | null;
  storagePercent?: number | null;
  trend?: TrendDirection;
  status: SituationStatus;
  freshness: FreshnessStatus;
  alertReason?: LocalizedString;
  isUpstreamAlert?: boolean;
  lastUpdated: string;
}

export interface StationSnapshotItem {
  id: string;
  code: string;
  type: StationType;
  name: LocalizedString;
  province?: LocalizedString;
  river?: LocalizedString;
  agency: LocalizedString;
  lat: number;
  lon: number;
  current?: StationTelemetrySummary;
}

export interface StationListDataset {
  schemaVersion: string;
  datasetVersion: string;
  basin: string;
  generatedAt: string;
  totalStations: number;
  stations: StationSnapshotItem[];
}

export interface StationDetailDataset {
  schemaVersion: string;
  datasetVersion: string;
  generatedAt: string;
  station: {
    id: string;
    code: string;
    basin: string;
    type: StationType;
    name: LocalizedString;
    address: LocalizedString;
    agency: LocalizedString;
    river?: LocalizedString;
    location: StationLocation;
    thresholds: StationThresholds;
    source: {
      provider: string;
      sourceStationId: string;
    };
    relationsSummary?: {
      influencingRainfallCount?: number;
      streamFallCount?: number;
      receivingWaterlevelCount?: number;
      receivingStationIds?: string[];
      nextStationId?: string | null;
      streamFallName?: string | null;
    };
    status: "active" | "inactive" | "unknown";
  };
}
