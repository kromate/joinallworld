import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'ado-ekiti',
  name: 'Ado-Ekiti',
  state: { id: 'ekiti', name: 'Ekiti', sourceName: 'Ekiti', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 5.22274,
    lat: 7.6232482,
    teaser: 'Farm-produce trade and the Bisi Market in the Ekiti State capital.',
    preview: ['Visit the cathedral and Bisi Market.', 'Cross the city through Ado-Ekiti.'],
    coordinateSourceId: 'osm-selected',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 501540913 },
  },
  population: { tier: 'small-city', sourceIds: ['wikipedia-ado-ekiti'], note: "Wikipedia reports 313,690 residents at the 2006 census; the figure is that article's dated count." },
  localUnits: [
    { id: 'ado-ekiti', name: 'Ado-Ekiti', sourceName: 'Ado-Ekiti', populationTier: 'small-city', description: 'The selected local government contains the state government territory, the cathedral, the mosque, Bisi Market, the mapped garden and the Federal Polytechnic point.', sourceIds: ['geography'] },
    { id: 'irepodun-ifelodun', name: 'Irepodun/Ifelodun', sourceName: 'Irepodun/Ifelodun', populationTier: 'town', description: 'The selected local government contains the Ekiti State University and Afe Babalola University points.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-patrick-cathedral', name: 'St Patrick Catholic Church Cathedral', kind: 'church', lon: 5.2256714, lat: 7.6210911, localUnitId: 'ado-ekiti',
      description: 'A mapped Catholic cathedral named St Patrick Catholic Church Cathedral in Ado-Ekiti.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 858960580 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ansarudeen-mosque', name: 'Ansarudeen Mosque', kind: 'mosque', lon: 5.223376, lat: 7.6217835, localUnitId: 'ado-ekiti',
      description: 'A mapped Sunni mosque named Ansarudeen Mosque in Ado-Ekiti.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 858954914 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'asha-botanical-garden', name: 'Asha Botanical Garden', kind: 'garden', lon: 5.2055419, lat: 7.6439888, localUnitId: 'ado-ekiti',
      description: 'A mapped garden named Asha Botanical Garden, tagged open daily from 09:00 to 22:00.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13328620547 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'ekiti-state-government-territory', name: 'Ekiti State Government Territory', kind: 'government', lon: 5.213132, lat: 7.6226142, localUnitId: 'ado-ekiti',
      description: 'A mapped point tagged Ekiti State Government Territory in Ado-Ekiti.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 2501731912 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'bisi-market', name: 'Bisi Market', kind: 'market', lon: 5.2231437, lat: 7.6241524, localUnitId: 'ado-ekiti',
      description: 'A marketplace named Bisi Market in Ekiti State, placed at its Wikidata point. Its specialty link is the city-wide farm-produce trade, not a market-specific source.', sourceIds: ['wikidata-selected', 'wikipedia-ado-ekiti'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136485306' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['ado-farm-produce'],
    },
    {
      id: 'diamond-barbing-saloon', name: 'Diamond Barbing Saloon', kind: 'salon', lon: 5.2543408, lat: 7.6153444, localUnitId: 'ado-ekiti',
      description: 'A mapped hairdresser named Diamond Barbing Saloon, tagged open Monday to Saturday from 08:00 to 20:00.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13339164964 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'wema-bank-ado', name: 'Wema Bank', kind: 'savings', lon: 5.2212479, lat: 7.6248369, localUnitId: 'ado-ekiti',
      description: 'A mapped bank tagged Wema Bank in Ado-Ekiti.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 2501738072 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'afe-babalola-university-teaching-hospital', name: 'Afe Babalola University Teaching Hospital', kind: 'hospital', lon: 5.2552407, lat: 7.608437, localUnitId: 'ado-ekiti',
      description: 'A hospital in Ekiti State named Afe Babalola University Teaching Hospital, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q132126844' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp', 'planter'] },
    },
    {
      id: 'federal-polytechnic-ado-ekiti', name: 'Federal Polytechnic, Ado-Ekiti', kind: 'polytechnic', lon: 5.291785, lat: 7.593134, localUnitId: 'ado-ekiti',
      description: 'A federal polytechnic named Federal Polytechnic, Ado-Ekiti, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q18354909' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'afe-babalola-university', name: 'Afe Babalola University', kind: 'university', lon: 5.307051, lat: 7.670929, localUnitId: 'irepodun-ifelodun',
      description: 'A private university named Afe Babalola University, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q4688832' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ekiti-state-university', name: 'Ekiti State University', kind: 'university', lon: 5.25753, lat: 7.72117, localUnitId: 'irepodun-ifelodun',
      description: 'A university named Ekiti State University in Ado-Ekiti, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q7895014' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ekiti-state-house-of-assembly', name: 'Ekiti State House of Assembly', kind: 'civic-landmark', lon: 5.197914763161205, lat: 7.636085710703682, localUnitId: 'ado-ekiti',
      description: 'The legislative arm of the Ekiti state government, named Ekiti State House of Assembly and placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q59518829' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'ekiti-state-library-board', name: 'Ekiti State Library Board', kind: 'civic-landmark', lon: 5.21678333333, lat: 7.65487, localUnitId: 'ado-ekiti',
      description: 'A public library named Ekiti State Library Board, placed at its Wikidata point.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q116041053' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['bench'] },
    },
  ],
  identity: {
    foods: [
      { id: 'ado-farm-produce', name: 'Yam, cassava and grain', description: 'Wikipedia calls Ado-Ekiti a trade centre for farm produce where yams, cassava, grain and tobacco are grown.', sourceIds: ['wikipedia-ado-ekiti'] },
    ],
    crafts: [
      { id: 'ado-cloth-weaving', name: 'Cotton cloth weaving', description: 'Wikipedia says cotton is grown around Ado-Ekiti for weaving.', sourceIds: ['wikipedia-ado-ekiti'] },
    ],
    industries: [
      { id: 'ado-farm-trade', name: 'Farm-produce trade', description: 'Wikipedia calls Ado-Ekiti a trade centre for farm produce.', sourceIds: ['wikipedia-ado-ekiti'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry', rainyMonths: [3, 4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2],
    description: 'A tropical climate with 1,424 mm of yearly rain; the Wikipedia table shows heavy rain from March to October and little from November to February.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-ado-ekiti'],
  },
  homePalette: { back: '#b9c2a2', left: '#667a4f', floor: ['#c4ad7a', '#587653'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/ado-ekiti-surface.geojson', bytes: 106282, sha256: '86fdde77b747c019e6dc6b5e344005de52f87bfdac2fc713cbe7e2472601ccb5' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Ado-Ekiti', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/ado-ekiti/reviewed/osm-selected.json', bytes: 2083, sha256: '4ec0afe75bace119bae5b367f034fff9c76b2bc0c574f171a52c9c168bd08efa' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Ado-Ekiti', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/ado-ekiti/reviewed/wikidata-selected.json', bytes: 6418, sha256: 'e3aeb187449cac8b9c2804defa6692da1199e5cb2a5db8a67a6c02950be1aa3d' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/ado-ekiti/reviewed/geography.json', bytes: 410, sha256: '9d21172b50676f946d5eaa385d3727f535f10c04a8cb2bf9038dabc60c089ea6' } },
    { id: 'wikipedia-ado-ekiti', title: 'Ado Ekiti (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Ado_Ekiti', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/ado-ekiti/reviewed/wikipedia-ado-ekiti.json', bytes: 535, sha256: '7710d054361fac94200053060408d7716a62f03204c7e2f809411e38cae2da66' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'park', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'stadium', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'road-hub', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
