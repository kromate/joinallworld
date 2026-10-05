import type { ModuleCharacter } from '../../../map3d/cities/module.ts'
import type { ContextSpec } from '../../../map3d/context.ts'
import { IBADAN_RAIL_ROUTE } from '../ibadan/landmarks.ts'
import { ABEOKUTA_ROUTE_GEOMETRY } from '../abeokuta/rail.ts'

/** The four Ogun cities that have a map pack. */
export type OgunCityId = 'abeokuta' | 'ota' | 'ijebu-ode' | 'sagamu'

/**
 * The part of the OpenStreetMap files (roads, water) each city map keeps, as [west, south, east, north] in degrees: the city's play
 * area with a margin, so that the roads and rivers that carry on past its edge are drawn a little way into the land around it.
 */
export const OGUN_SCOPE: Readonly<Record<OgunCityId, readonly [number, number, number, number]>> = Object.freeze({
  abeokuta: [2.97, 6.64, 3.84, 7.53],
  ota: [2.78, 6.4, 3.42, 6.86],
  'ijebu-ode': [3.55, 6.58, 4.22, 7.04],
  sagamu: [3.32, 6.58, 3.96, 7.18],
})

/** A quarter or town named on the ground. Centres are approximate: the data holds area names, not boundaries. */
export interface OgunQuarter { id: string; name: string; lon: number; lat: number }
const quarters = (rows: readonly (readonly [string, number, number])[]): readonly OgunQuarter[] => rows.map(([name, lon, lat]) => ({ id: `quarter-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, lon, lat }))

/** Names laid on the ground (see PackDistrict in src/map3d/types.ts); a plate that would lie across a venue or another plate is left off. */
export const OGUN_QUARTERS: Readonly<Record<OgunCityId, readonly OgunQuarter[]>> = Object.freeze({
  abeokuta: quarters([
    ['Ake', 3.3512, 7.1648], ['Itoku', 3.3418, 7.1552], ['Lafenwa', 3.3282, 7.1590], ['Kuto', 3.3520, 7.1360], ['Oke-Mosan', 3.3680, 7.1500],
    ['Idi-Aba', 3.3625, 7.1235], ['Ibara', 3.3250, 7.1330], ['Isale Igbein', 3.3560, 7.1700], ['Odeda', 3.5130, 7.2440], ['Ofada', 3.4650, 6.9150],
  ]),
  ota: quarters([
    ['Sango-Ota', 3.2429, 6.7140], ['Ota', 3.2167, 6.6840], ['Canaanland', 3.1635, 6.6795], ['Agbara', 3.0830, 6.5170], ['Ado-Odo', 2.9480, 6.5830],
    ['Ota Industrial Estate', 3.2030, 6.6960], ['Ilo-Awori', 3.1500, 6.6050], ['Iju', 3.1500, 6.7050],
  ]),
  'ijebu-ode': quarters([
    ['Ijasi', 3.9230, 6.8250], ['Isoku', 3.9060, 6.8130], ['Italapo', 3.9120, 6.8190], ['Ojude Oba ground', 3.9152, 6.8140], ['Ijagun', 3.9300, 6.7850],
    ['Odogbolu', 3.7450, 6.8350], ['Imoru', 3.9420, 6.8170],
  ]),
  sagamu: quarters([
    ['Sagamu', 3.6460, 6.8420], ['Ode-Remo', 3.6880, 6.8350], ['Ikenne', 3.7167, 6.8667], ['Ilishan-Remo', 3.7300, 6.8960], ['Sagamu Interchange', 3.5690, 6.8950],
    ['Isote', 3.6350, 6.8570],
  ]),
})

type Line = readonly (readonly [number, number])[]
const SGR: Line = [...(IBADAN_RAIL_ROUTE.segments[0] ?? []), ...(IBADAN_RAIL_ROUTE.segments[1] ?? [])]

/**
 * How each Ogun city reads from above. Old, dense, brown-roofed quarters against planned and leafy ones; Abeokuta's granite outcrops as
 * steep low mounds (centres approximate: the data holds no summits); the railway that crosses the city; the roads that carry it.
 * Venue ids of each city's landmarks are kept longest where labels crowd. Roads and water come from the OpenStreetMap files.
 */
export const OGUN_CHARACTER: Readonly<Record<OgunCityId, ModuleCharacter>> = Object.freeze({
  abeokuta: {
    extent: 'city',
    notable: ['olumo-rock', 'alake-palace', 'centenary-hall', 'itoku-market', 'kuto-market', 'mko-stadium', 'oopl', 'funaab', 'wole-soyinka-station', 'ogun-river'],
    areas: [
      { name: 'Ake and Isale Igbein', lon: 3.3520, lat: 7.1655, km: 1.0, tone: 'old' },
      { name: 'Itoku and Ago-Oba', lon: 3.3430, lat: 7.1565, km: 0.9, tone: 'old' },
      { name: 'Lafenwa', lon: 3.3290, lat: 7.1560, km: 0.9, tone: 'old' },
      { name: 'Kuto', lon: 3.3500, lat: 7.1395, km: 1.1, tone: 'old' },
      { name: 'Oke-Mosan', lon: 3.3680, lat: 7.1500, km: 1.1, tone: 'planned' },
      { name: 'Idi-Aba', lon: 3.3610, lat: 7.1280, km: 1.1, tone: 'planned' },
      { name: 'Ibara GRA', lon: 3.3250, lat: 7.1350, km: 0.9, tone: 'planned' },
      { name: 'FUNAAB', lon: 3.4356, lat: 7.2236, km: 1.7, tone: 'planned' },
    ],
    hills: [
      { name: 'Olumo Rock', lon: 3.3426, lat: 7.1672, km: 0.7, rise: 1.8 },
      { name: 'Oke Ilewo', lon: 3.3590, lat: 7.1585, km: 0.6, rise: 1.2 },
      { name: 'Oke Ona', lon: 3.3320, lat: 7.1745, km: 0.6, rise: 1.0 },
      { name: 'Oke Mosan', lon: 3.3700, lat: 7.1530, km: 0.7, rise: 1.0 },
      { name: 'Oke Lantoro', lon: 3.3650, lat: 7.1360, km: 0.6, rise: 0.9 },
      { name: 'Granite outcrops of Odeda', lon: 3.5000, lat: 7.2500, km: 1.4, rise: 1.0 },
    ],
    rails: [{ name: IBADAN_RAIL_ROUTE.name, lines: ABEOKUTA_ROUTE_GEOMETRY.map((route) => route.points), stations: [{ name: 'Professor Wole Soyinka Station', lon: 3.39847, lat: 7.12885 }] }],
    trunkRoads: ['Lagos-Abeokuta Expressway', 'Abeokuta-Sagamu Expressway', 'Lagos-Ibadan Expressway', 'Old Abeokuta Road', 'Iyaganku Road'],
  },
  ota: {
    extent: 'city',
    notable: ['covenant-university', 'bells-university', 'sango-market', 'canaanland-worship', 'ota-industry-walk'],
    areas: [
      { name: 'Sango-Ota', lon: 3.2429, lat: 6.7072, km: 1.3, tone: 'old' },
      { name: 'Ota town', lon: 3.2167, lat: 6.6833, km: 1.3, tone: 'old' },
      { name: 'Ota Industrial Estate', lon: 3.2030, lat: 6.6960, km: 1.2, tone: 'old' },
      { name: 'Agbara Industrial Estate', lon: 3.0830, lat: 6.5170, km: 1.9, tone: 'old' },
      { name: 'Ado-Odo', lon: 2.9480, lat: 6.5830, km: 1.1, tone: 'old' },
      { name: 'Canaanland and Bells', lon: 3.1635, lat: 6.6790, km: 1.7, tone: 'planned' },
    ],
    rails: [{ name: IBADAN_RAIL_ROUTE.name, lines: [SGR], stations: [] }],
    trunkRoads: ['Lagos-Abeokuta Expressway', 'Lagos-Badagry Expressway', 'Idi-Iroko Road'],
  },
  'ijebu-ode': {
    extent: 'city',
    notable: ['ojude-oba-forecourt', 'tasued', 'dipo-dina-stadium', 'ijebu-market', 'ijebu-central-mosque', 'ijebu-museum'],
    areas: [
      { name: 'Ijasi and Italapo', lon: 3.9175, lat: 6.8210, km: 1.1, tone: 'old' },
      { name: 'Isoku and Ita-Ntebo', lon: 3.9070, lat: 6.8130, km: 1.0, tone: 'old' },
      { name: 'Ojude Oba ground', lon: 3.9152, lat: 6.8140, km: 0.6, tone: 'old' },
      { name: 'Ijagun and TASUED', lon: 3.9300, lat: 6.7930, km: 1.5, tone: 'planned' },
      { name: 'Imoru and the stadium', lon: 3.9400, lat: 6.8170, km: 1.0, tone: 'planned' },
      { name: 'Odogbolu', lon: 3.7450, lat: 6.8350, km: 1.0, tone: 'old' },
      { name: 'Forest edge', lon: 3.9300, lat: 6.9250, km: 3.0, tone: 'planned' },
    ],
    trunkRoads: ['Benin-Sagamu Expressway', 'Sagamu-Benin Expressway', 'Lagos-Benin Road'],
  },
  sagamu: {
    extent: 'city',
    notable: ['babcock-university', 'sagamu-interchange', 'ikenne-heritage', 'sagamu-market', 'remo-stadium', 'ilisan-chapel'],
    areas: [
      { name: 'Sagamu old town', lon: 3.6460, lat: 6.8430, km: 1.3, tone: 'old' },
      { name: 'Ode-Remo', lon: 3.6880, lat: 6.8350, km: 1.0, tone: 'old' },
      { name: 'Ikenne', lon: 3.7167, lat: 6.8667, km: 1.2, tone: 'old' },
      { name: 'Ilishan-Remo and Babcock', lon: 3.7260, lat: 6.8930, km: 1.7, tone: 'planned' },
      { name: 'Interchange', lon: 3.5690, lat: 6.8900, km: 0.9, tone: 'planned' },
    ],
    trunkRoads: ['Lagos-Ibadan Expressway', 'Benin-Sagamu Expressway', 'Abeokuta-Sagamu Expressway', 'Sagamu Road'],
  },
})

/**
 * What lies around each city map, drawn quiet under it: Lagos and the Atlantic to the south, Oyo to the north, Benin on the west
 * (the Ipokia and Yewa side), Ondo and Osun to the east. The roads inside each map are the OpenStreetMap ones; none is invented here.
 */
const around = (names: ContextSpec['names']): ContextSpec => ({ own: 'ogun', countries: ['bj', 'tg'], roads: [], names })
export const OGUN_SURROUNDINGS: Readonly<Record<OgunCityId, ContextSpec>> = Object.freeze({
  abeokuta: around([
    { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [4.0, 6.75] },
    { id: 'lagos', text: 'LAGOS STATE', kind: 'state', at: [3.4, 6.5] },
    { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.55, 7.85] },
    { id: 'osun', text: 'OSUN STATE', kind: 'state', at: [4.45, 7.6] },
    { id: 'ondo', text: 'ONDO STATE', kind: 'state', at: [4.95, 6.95] },
    { id: 'benin', text: 'REPUBLIC OF BENIN', kind: 'country', at: [2.45, 7.1] },
    { id: 'sea', text: 'ATLANTIC OCEAN', kind: 'sea', at: [3.4, 6.15] },
  ]),
  ota: around([
    { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [3.05, 6.97] },
    { id: 'lagos', text: 'LAGOS STATE', kind: 'state', at: [3.5, 6.52] },
    { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.8, 7.7] },
    { id: 'benin', text: 'REPUBLIC OF BENIN', kind: 'country', at: [2.5, 6.7] },
    { id: 'sea', text: 'ATLANTIC OCEAN', kind: 'sea', at: [3.15, 6.18] },
  ]),
  'ijebu-ode': around([
    { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [3.9, 7.14] },
    { id: 'lagos', text: 'LAGOS STATE', kind: 'state', at: [3.95, 6.42] },
    { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.75, 7.7] },
    { id: 'osun', text: 'OSUN STATE', kind: 'state', at: [4.5, 7.55] },
    { id: 'ondo', text: 'ONDO STATE', kind: 'state', at: [4.8, 6.85] },
    { id: 'sea', text: 'ATLANTIC OCEAN', kind: 'sea', at: [4.0, 6.05] },
  ]),
  sagamu: around([
    { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [4.05, 6.95] },
    { id: 'lagos', text: 'LAGOS STATE', kind: 'state', at: [3.55, 6.52] },
    { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.65, 7.55] },
    { id: 'ondo', text: 'ONDO STATE', kind: 'state', at: [4.7, 6.9] },
    { id: 'benin', text: 'REPUBLIC OF BENIN', kind: 'country', at: [2.6, 6.9] },
    { id: 'sea', text: 'ATLANTIC OCEAN', kind: 'sea', at: [3.6, 6.15] },
  ]),
})
