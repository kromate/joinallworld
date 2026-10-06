import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'kaduna',
  name: 'Kaduna',
  state: { id: 'kaduna', name: 'Kaduna', sourceName: 'Kaduna', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 7.4402777777778,
    lat: 10.523055555556,
    teaser: 'Textiles, farm exports and the Kaduna River in the northern industrial capital.',
    preview: ['Visit Arewa House and the National Museum.', 'Cross the city through Kaduna North and South.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q208318' },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-kaduna'], note: "Wikipedia reports 760,084 residents at the 2006 census; the figure is that article's dated count." },
  localUnits: [
    { id: 'kaduna-north', name: 'Kaduna North', sourceName: 'Kaduna North', populationTier: 'city', description: 'The selected northern local government contains the churches, mosque, markets, stadium, motor parks and the national museum.', sourceIds: ['geography'] },
    { id: 'kaduna-south', name: 'Kaduna South', sourceName: 'Kaduna South', populationTier: 'city', description: 'The selected southern local government contains Government House, the Television Market and Barnawa hospital.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-johns-catholic-church', name: 'St Johns Catholic Church', kind: 'church', lon: 7.4529223, lat: 10.5159037, localUnitId: 'kaduna-north',
      description: 'A mapped Catholic place of worship named St Johns Catholic Church in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 552969130 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'sultan-bello-mosque', name: 'Sultan Bello Mosque', kind: 'mosque', lon: 7.4455125, lat: 10.5508119, localUnitId: 'kaduna-north',
      description: 'A mapped Muslim place of worship named Sultan Bello Mosque in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 462364812 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'love-garden', name: 'Love Garden', kind: 'park', lon: 7.4427806, lat: 10.6100211, localUnitId: 'kaduna-north',
      description: 'A mapped park named Love Garden in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13032418048 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'kaduna-government-house', name: 'Government House', kind: 'government', lon: 7.4172744, lat: 10.5279498, localUnitId: 'kaduna-south',
      description: 'A mapped government office named Government House in Kaduna South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 2986601792 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'kaduna-secretariat', name: 'Kaduna Secretariat', kind: 'government', lon: 7.4397736, lat: 10.5222972, localUnitId: 'kaduna-north',
      description: 'A mapped public building named Kaduna Secretariat in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 559475188 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'giwa-hospital', name: 'Giwa Hospital', kind: 'hospital', lon: 7.4331361, lat: 10.5430895, localUnitId: 'kaduna-north',
      description: 'A mapped hospital named Giwa Hospital on Ahmadu Bello Way, tagged open around the clock.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7427962286 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'neuro-psychiatric-hospital-barnawa', name: 'Federal Neuro-Psychiatric Hospital Barnawa', kind: 'hospital', lon: 7.4293294, lat: 10.4630718, localUnitId: 'kaduna-south',
      description: 'A mapped hospital named Federal Neuro-Psychiatric Hospital, Barnawa in Kaduna South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7359471294 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'chechinya-market', name: 'Chechinya Market', kind: 'market', lon: 7.4259383, lat: 10.5205616, localUnitId: 'kaduna-north',
      description: 'A mapped marketplace named Chechinya Market in Kaduna North. Its specialty link is the city-level textile industry, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-kaduna'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 38977423 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['kaduna-textiles'],
    },
    {
      id: 'unguwan-rimi-market', name: 'Unguwan Rimi Market', kind: 'market', lon: 7.4637506, lat: 10.5275466, localUnitId: 'kaduna-north',
      description: "A mapped marketplace named Unguwan Rimi Market in Kaduna North. Its specialty link is the region's farm exports, not a market-specific source.", sourceIds: ['osm-selected', 'wikipedia-kaduna'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 487208406 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['kaduna-sorghum-groundnut'],
    },
    {
      id: 'television-market', name: 'Television Market', kind: 'market', lon: 7.4302297, lat: 10.4500027, localUnitId: 'kaduna-south',
      description: 'A mapped marketplace named Television Market in Kaduna South. Its specialty link is the city-level textile industry, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-kaduna'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 787201275 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['kaduna-textiles'],
    },
    {
      id: 'mafzee-collection-and-spa', name: 'MAFZEE Collection and Spa', kind: 'salon', lon: 7.4332581, lat: 10.5883497, localUnitId: 'kaduna-north',
      description: 'A mapped beauty shop named MAFZEE Collection and Spa on Mando Road, tagged open Monday to Friday from 09:00 to 18:00.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 12810997012 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'zenith-bank-kaduna', name: 'Zenith Bank', kind: 'savings', lon: 7.4319104, lat: 10.5226693, localUnitId: 'kaduna-north',
      description: 'A mapped bank named Zenith Bank in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 543689347 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'ahmadu-bello-stadium', name: 'Ahmadu Bello Stadium', kind: 'stadium', lon: 7.4282524, lat: 10.4998141, localUnitId: 'kaduna-north',
      description: 'A mapped stadium named Ahmadu Bello Stadium in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 38919394 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'kawo-motor-park', name: 'Kawo Motor Park', kind: 'road-hub', lon: 7.4482621, lat: 10.5855004, localUnitId: 'kaduna-north',
      description: 'A mapped bus station named Kawo Motor Park in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 38919157 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'kaduna-polytechnic', name: 'Kaduna Polytechnic', kind: 'university', lon: 7.4164525, lat: 10.5225202, localUnitId: 'kaduna-south',
      description: 'Kaduna Polytechnic, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q23019261' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'kaduna-state-university', name: 'Kaduna State University', kind: 'university', lon: 7.4337, lat: 10.5036, localUnitId: 'kaduna-north',
      description: 'Kaduna State University, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q6345764' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'national-museum-kaduna', name: 'National Museum Kaduna', kind: 'museum', lon: 7.43967, lat: 10.5607, localUnitId: 'kaduna-north',
      description: 'The National Museum Kaduna, placed at its Wikidata point; Wikivoyage describes the Kaduna museum of the National Commission for Museums and Monuments as telling the story of the Kaduna people.', sourceIds: ['wikidata-selected', 'wikivoyage-kaduna'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q6345759' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'arewa-house-museum', name: 'Arewa House Museum', kind: 'museum', lon: 7.446441583672294, lat: 10.553898479787794, localUnitId: 'kaduna-north',
      description: 'Arewa House Museum, placed at its Wikidata point; Wikivoyage describes Arewa House as the converted private residence of Sir Ahmadu Bello.', sourceIds: ['wikidata-selected', 'wikivoyage-kaduna'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q121741997' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'kaduna-war-memorial-stone', name: 'Kaduna 2nd World War Memorial Stone', kind: 'heritage', lon: 7.4543993, lat: 10.5348971, localUnitId: 'kaduna-north',
      description: 'A mapped historic monument named Kaduna 2nd World War Memorial Stone in Kaduna North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 544424308 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'kaduna-sorghum-groundnut', name: 'Sorghum and groundnuts', description: 'Wikipedia lists cotton, peanuts, sorghum and ginger among the main agricultural exports of the Kaduna area.', sourceIds: ['wikipedia-kaduna'] },
    ],
    crafts: [
      { id: 'kaduna-textiles', name: 'Textile making', description: 'Wikipedia says Kaduna manufactures textiles, though the textile industry has declined with imports and factory closures.', sourceIds: ['wikipedia-kaduna'] },
    ],
    industries: [
      { id: 'kaduna-industry', name: 'Textiles, steel and petroleum products', description: 'Wikipedia calls Kaduna a major industrial centre of Northern Nigeria manufacturing textiles, machinery, steel, aluminium, petroleum products and bearings.', sourceIds: ['wikipedia-kaduna'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'northern-savanna', rainyMonths: [5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3, 4],
    description: 'A tropical savanna climate with about 998 mm of yearly rain; the Wikivoyage chart shows heavy rain from May to October and almost none from November to March.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-kaduna', 'wikivoyage-kaduna'],
  },
  homePalette: { back: '#d9b98c', left: '#8f6a42', floor: ['#c9a56a', '#6b7c4c'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/kaduna-surface.geojson', bytes: 592296, sha256: 'd5c2aacb303040eb8c079e842dc90703d9f5767783361cefd7753ea002b82827' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Kaduna', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/kaduna/reviewed/osm-selected.json', bytes: 4038, sha256: 'b5e151626aa29f542cd461990fb360e09eccb6a982e3b4d8fddbc7084a6bfe47' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Kaduna', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/kaduna/reviewed/wikidata-selected.json', bytes: 5238, sha256: '8ffeacdf346daa8d9dda89c7b7cf8cd5fe9e6335a2c241e09c9828055197f83d' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/kaduna/reviewed/geography.json', bytes: 408, sha256: 'd703d3d9d94e326e7fd3cebd944db9e61fbedf4b65298eed37d0e5b5305cb733' } },
    { id: 'wikipedia-kaduna', title: 'Kaduna (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kaduna', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/kaduna/reviewed/wikipedia-kaduna.json', bytes: 639, sha256: 'f541474cc6e2fda4245402d4c355f377fe8564bc233961b390bec630a667eee2' } },
    { id: 'wikivoyage-kaduna', title: 'Kaduna (Wikivoyage)', url: 'https://en.wikivoyage.org/wiki/Kaduna', checkedOn: '2026-10-06', supports: ['identity', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/kaduna/reviewed/wikivoyage-kaduna.json', bytes: 581, sha256: 'f644bf6c6166ab7f3ff584678ad711586e9dcd312095c18e3dfc5715dc4b4c2a' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'garden', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
