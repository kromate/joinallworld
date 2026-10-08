/** Display-only geographic detail. These values never grant gameplay/travel access. */
export interface CountryDetailChoice {
  countryId: string;
  name: string;
  continent: string;
  atlasId: string | null;
  status: 'mapped' | 'protected' | 'missing';
}

export interface CountryDetailCatalogue {
  countries: readonly CountryDetailChoice[];
  sourceLabel: string;
  sourceUrl: string;
  boundaryNote: string;
}

export interface CountryDetailOutline {
  country: CountryDetailChoice;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  attribution: string;
  limitations: readonly string[];
}

export interface CountryDetailService {
  catalogue(signal: AbortSignal): Promise<CountryDetailCatalogue>;
  load(countryId: string, signal: AbortSignal): Promise<CountryDetailOutline>;
}
