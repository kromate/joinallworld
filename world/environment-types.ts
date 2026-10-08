import type { ClimateProfile, SourceRecord } from './types.ts';

export interface EnvironmentRequest {
  schemaVersion: 1;
  id: string;
  regionId: string;
  name: string;
  longitude: number;
  latitude: number;
  baseline: { startYear: 1991; endYear: 2020 };
}

export interface EnvironmentManifest {
  schemaVersion: 1;
  id: string;
  region: { id: string; name: string };
  point: {
    longitude: number; latitude: number;
    requestedLongitude: number; requestedLatitude: number;
    semantics: 'representative-point-selected-on-native-source-grid';
  };
  baseline: { startYear: 1991; endYear: 2020; years: 30 };
  profile: ClimateProfile;
  source: SourceRecord & {
    provider: 'NASA POWER';
    apiVersion: string;
    product: 'monthly point';
    sourceDatasets: string[];
    timeStandard: string;
    fillValue: number;
    units: { T2M: 'C'; RH2M: '%'; PRECTOTCORR: 'mm/day'; WS10M: 'm/s' };
    spatialResolution: { latitudeDegrees: 0.5; longitudeDegrees: 0.625 };
    requestedParameters: ['T2M', 'RH2M', 'PRECTOTCORR', 'WS10M'];
    monthlyRecordCount: 360;
    annualRecordCount: 30;
  };
  derivation: {
    algorithmVersion: 'power-monthly-normal-v1';
    temperature: string;
    humidity: string;
    precipitation: string;
    wind: string;
  };
  exceptions: string[];
}

export interface PowerResponseReceipt {
  request: EnvironmentRequest;
  url: string;
  sha256: string;
  bytes: number;
  sourceCachePath: string;
  fetchedAt: string;
}
