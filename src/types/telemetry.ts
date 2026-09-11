import { LocalizedString } from "./common";
import { DataStatus, FreshnessStatus, RainIntensity, SituationStatus, TrendDirection } from "./station";

export interface WaterLevelObservation {
  timestamp: string;
  stage: number | null; // meters
  discharge: number | null; // m3/s
  waterLevelMsl: number | null; // meters MSL
  storagePercent?: number | null; // %
  status: DataStatus;
}

export interface RainfallObservation {
  timestamp: string;
  value: number | null; // mm
  unit: "mm";
  period: "15m" | "1h" | "24h" | "today";
  intensity?: RainIntensity;
  status: DataStatus;
}

export interface StationCurrentDataset {
  schemaVersion: string;
  datasetVersion: string;
  stationId: string;
  basin: string;
  type: "water_level" | "rainfall";
  timestamp: string;
  status: SituationStatus;
  freshness: FreshnessStatus;
  alertReason?: {
    th: string;
    en: string;
  };
  isUpstreamAlert?: boolean;
  waterLevel?: {
    stage: number | null;
    discharge: number | null;
    waterLevelMsl: number | null;
    storagePercent: number | null;
    trend: TrendDirection;
    thresholdComparison?: {
      warningDiff: number | null;
      criticalDiff: number | null;
      percentOfBank: number | null;
    };
  };
  rainfall?: {
    value1h: number | null;
    value3h?: number | null;
    value6h?: number | null;
    value24h: number | null;
    valueToday: number | null;
    intensity: RainIntensity;
  };
  updatedAt: string;
}

export interface StationCurrentItem {
  timestamp: string;
  status: SituationStatus;
  freshness: FreshnessStatus;
  alertReason?: {
    th: string;
    en: string;
  };
  isUpstreamAlert?: boolean;
  stage?: number | null;
  discharge?: number | null;
  waterLevelMsl?: number | null;
  storagePercent?: number | null;
  trend?: TrendDirection;
  rainfall1h?: number | null;
  rainfall3h?: number | null;
  rainfall6h?: number | null;
  rainfall24h?: number | null;
  rainfallToday?: number | null;
  intensity?: RainIntensity;
  updatedAt: string;
}

export interface BasinCurrentDataset {
  schemaVersion: string;
  datasetVersion: string;
  basin: string;
  type: "water_level" | "rainfall";
  generatedAt: string;
  totalStations: number;
  stations: Record<string, StationCurrentItem>;
}

export interface StationHistoryDataset {
  schemaVersion: string;
  datasetVersion: string;
  stationId: string;
  basin: string;
  type: "water_level" | "rainfall";
  date: string; // YYYY-MM-DD
  generatedAt: string;
  observations: WaterLevelObservation[] | RainfallObservation[];
}

export interface StationRelationItem {
  type: "rainfall_influence" | "downstream_gauge" | "tributary" | "upstream";
  stationId: string;
  targetStationId: string;
  name: LocalizedString;
  targetStationName: LocalizedString;
  stationType: "water_level" | "rainfall";
  distanceKm: number;
  travelTimeHours: number | null;
  influenceWeightPercent: number | null;
  latestValue?: string;
  status: SituationStatus;
  isUpstream: boolean;
}

export interface StationRelationsDataset {
  schemaVersion: string;
  datasetVersion: string;
  stationId: string;
  stationType?: "water_level" | "rainfall";
  basin: string;
  generatedAt: string;
  influencingRainfallStations?: any[];
  streamFall?: any[];
  downstreamStations?: any[];
  receivingWaterlevelStations?: any[];
  relations: StationRelationItem[];
}
