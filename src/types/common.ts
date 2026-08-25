export interface LocalizedString {
  th: string;
  en: string;
}

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];
export type Coordinate = [lon: number, lat: number];

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    version?: string;
    [key: string]: any;
  };
}
