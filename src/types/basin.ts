import { BBox, LocalizedString } from "./common";
import { SituationStatus } from "./station";

export interface BasinSummary {
  id: string;
  slug: string;
  code: string;
  name: LocalizedString;
  description?: LocalizedString;
  mainRivers?: LocalizedString[];
  provinces?: LocalizedString[];
  areaKm2?: number;
  totalStations: number;
  waterLevelStationsCount: number;
  rainfallStationsCount: number;
  overallStatus: SituationStatus;
  statusSummary?: BasinStatusSummary;
  lastUpdated: string;
  bgGradient?: string;
  accentColor?: string;
  center?: [number, number];
  zoom?: number;
}

export interface BasinStatusSummary {
  normalCount: number;
  watchCount: number;
  warningCount: number;
  criticalCount: number;
  missingCount: number;
  risingCount: number;
  heavyRainCount: number;
}

export interface BasinDetail extends BasinSummary {
  boundaryGeojsonPath?: string | null;
  flowPathsGeojsonPath?: string | null;
}

export interface BasinsListDataset {
  schemaVersion: string;
  datasetVersion: string;
  generatedAt: string;
  totalBasins: number;
  basins: BasinSummary[];
}

export interface BasinOverviewDataset {
  schemaVersion: string;
  datasetVersion: string;
  basin: string;
  generatedAt: string;
  summary: {
    totalStations: number;
    waterLevelStations: number;
    rainfallStations: number;
    overallStatus: SituationStatus;
    statusSummary: BasinStatusSummary;
  };
  keyStations: {
    critical: any[];
    warning: any[];
    watch: any[];
  };
  rainfallHighlights: any[];
  riverHighlights: any[];
}
