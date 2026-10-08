/**
 * Source and sidecar contract for the Copernicus GLO-90 Accra pilot.
 * This deliberately does not extend the shared world-pack types: the raw
 * source is an EGM2008 DSM and cannot be mixed into the ellipsoid-height game
 * frame until a verified geoid conversion exists.
 */

export type TerrainVerticalReference =
  | {
      status: 'source-stated-cog-vertical-key-absent';
      datum: 'EGM2008';
      epsg: 3855;
      unit: 'm';
      evidence: string;
    }
  | {
      status: 'unknown';
      datum: 'unknown';
      epsg: null;
      unit: 'unknown';
      evidence: string;
    };

export interface TerrainSourceContract {
  provider: 'Copernicus';
  product: 'Copernicus DEM GLO-90';
  surfaceModel: 'DSM';
  horizontalReference: { crs: 'WGS84-G1150'; epsg: 4326 };
  verticalReference: TerrainVerticalReference;
  nominalLatitudeResolutionArcSeconds: 3;
  longitudeResolutionByLatitudeBand: Array<{
    minAbsoluteLatitude: number;
    maxAbsoluteLatitude: number;
    arcSeconds: number;
  }>;
  attribution: string;
  licenseEvidence: string;
}

/** A bounded header/HTTP probe; kept alongside the measured tile receipt. */
export interface TerrainCogMetadataProbe {
  tileId: string;
  url: string;
  observedAt: string;
  metadataBytesInspected: number;
  cogObjectBytes: number;
  sha256: null;
  etag: string;
  lastModified: string;
  contentType: string;
  acceptsByteRanges: boolean;
  raster: {
    width: number;
    height: number;
    bitsPerSample: number;
    samplesPerPixel: number;
    compression: 'DEFLATE';
    tileWidth: number;
    tileHeight: number;
    horizontalEpsg: 4326;
    rasterType: 'PixelIsPoint';
    pixelScaleDegrees: [number, number];
    tiepoint: [number, number, number, number, number, number];
    verticalGeoKeyPresent: false;
  };
  sampleValuesInspected: false;
  evidence: string[];
}

export type TerrainCellState = 'data' | 'no_data' | 'tile_missing' | 'invalid';

/** Immutable native-grid sample-window sidecar for the bounded Accra request. */
export interface TerrainSidecarManifest {
  schemaVersion: 1;
  id: string;
  source: {
    provider: 'Copernicus';
    product: 'Copernicus DEM GLO-90';
    tileId: string;
    url: string;
    bytes: number;
    sha256: string;
    etag: string | null;
    lastModified: string | null;
  };
  surfaceModel: 'DSM';
  horizontalReference: { crs: 'WGS84-G1150'; epsg: 4326 };
  verticalReference: TerrainVerticalReference;
  grid: {
    width: number;
    height: number;
    longitudeStepArcSeconds: number;
    latitudeStepArcSeconds: 3;
    sampling: 'nearest-source-pixel';
    rasterType: 'PixelIsPoint';
    nativeRasterMetadata: Record<string, unknown>;
  };
  values: {
    unit: 'm';
    noDataEncoding: string;
    maskValidCount: number;
    maskInvalidCount: number;
    validMin: number;
    validMax: number;
    sampleBounds: [number, number, number, number];
    samples: Array<{
      longitude: number;
      latitude: number;
      valueMeters: number | null;
      state: TerrainCellState;
    }>;
    ellipsoidConversion: 'not-applied';
  };
  derivation: { algorithmVersion: string; sourceSha256: string };
  exceptions: string[];
  attribution: string;
}
