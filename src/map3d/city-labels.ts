import type { WorldCityId } from '../types/life.ts'
import type { CityMapNames } from '../types/content.ts'

/** Backdrop labels for the legacy schematic maps; loaded only with the map. */
export const CITY_MAPS: Partial<Record<WorldCityId, CityMapNames>> = {
  lagos: { north: 'MAINLAND', south: 'ISLAND', east: 'LEKKI', water: 'LAGOS LAGOON', sea: 'ATLANTIC OCEAN', bridges: ['Third Mainland Bridge', 'Carter Bridge', 'Link Bridge'] },
  ibadan: { north: 'BODIJA SIDE', south: 'DUGBE SIDE', east: 'AKOBO', water: 'OGUNPA RIVER', sea: 'ELEYELE LAKE', bridges: ['Mokola Flyover', 'Ogunpa Bridge', 'Iwo Road Bridge'] },
};
