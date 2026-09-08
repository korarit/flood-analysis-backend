import { BBox, LocalizedString } from "./common";
import { SituationStatus } from "./station";

export interface BasinSummary {
  id: string;
  slug: string;
  code: string;
  name: LocalizedString;
  totalStations: number;
  overallStatus: SituationStatus;
  lastUpdated: string;
  areaKm2?: number;
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
  description: LocalizedString;
  waterLevelStationsCount: number;
  rainfallStationsCount: number;
  statusSummary: BasinStatusSummary;
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
