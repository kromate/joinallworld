import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'lafia',
  name: 'Lafia',
  state: { id: 'nasarawa', name: 'Nasarawa', sourceName: 'Nasarawa', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 8.5147636,
    lat: 8.4960459,
    teaser: 'A Benue Valley market town for sesame, soybeans, yams and cotton weaving.',
    preview: ['Visit Lafia Market and John Castle.', 'Cross the city through the Lafia local government.'],
    coordinateSourceId: 'osm-selected',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 317967219 },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-lafia'], note: 'Wikipedia gives 509,300 inhabitants but labels the figure both a 2021 census count and a 2022 estimate; it is the Lafia local government figure from citypopulation.de.' },
  localUnits: [
    { id: 'lafia', name: 'Lafia', sourceName: 'Lafia', populationTier: 'city', description: 'The selected local government contains the markets, the Federal University of Lafia, the cathedral and the stadium.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'lafia-lg-secretariat', name: 'Lafia LGsec. Lafia', kind: 'government', lon: 8.524722, lat: 8.476412, localUnitId: 'lafia',
      description: 'A mapped government office tagged Lafia LGsec. Lafia.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8117504817 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'nasarawa-ministry-information-culture-tourism', name: 'Nasarawa State Ministry of Information, Culture and Tourism', kind: 'government', lon: 8.5296546, lat: 8.5047768, localUnitId: 'lafia',
      description: 'A Wikidata point for the state agency responsible for culture and tourism development in Lafia.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q130458740' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'voice-of-islam-hospital', name: 'Voice of Islam Hospital', kind: 'hospital', lon: 8.523472, lat: 8.5231474, localUnitId: 'lafia',
      description: 'A mapped hospital named Voice of Islam Hospital in Lafia.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13881274144 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'sauki-hospital-lafia', name: 'Sauki Hospital, Lafia', kind: 'hospital', lon: 8.5263686, lat: 8.5017942, localUnitId: 'lafia',
      description: 'A Wikidata point for Sauki Hospital, described there as a healthcare centre in Nigeria.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q128848354' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'federal-university-of-lafia', name: 'Federal University of Lafia', kind: 'university', lon: 8.5227, lat: 8.506, localUnitId: 'lafia',
      description: 'A Wikidata point for Federal University of Lafia; Wikipedia lists it among the institutions of Lafia.', sourceIds: ['wikidata-selected', 'wikipedia-lafia'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q5440481' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'nasarawa-state-poly-lafia', name: 'Nasarawa state poly, Lafia', kind: 'college', lon: 8.5352801, lat: 8.5458481, localUnitId: 'lafia',
      description: 'A mapped college tagged Nasarawa state poly, Lafia; Wikipedia lists Isa Mustapha Agwai I Polytechnic Lafia among the institutions of the city, and the match is an inference.', sourceIds: ['osm-selected', 'wikipedia-lafia'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8117622017 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'lafiya-city-stadium', name: 'Lafiya City Stadium', kind: 'stadium', lon: 8.5253428, lat: 8.5224578, localUnitId: 'lafia',
      description: 'A mapped stadium named Lafiya City Stadium in Lafia.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13881274143 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'ercc-graceland', name: 'Evangelical Reformed Church of Christ (ERCC), GraceLand', kind: 'church', lon: 8.5126072, lat: 8.5077025, localUnitId: 'lafia',
      description: 'A mapped Christian place of worship named Evangelical Reformed Church of Christ (ERCC), GraceLand.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 9865775509 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['bench'] },
    },
    {
      id: 'saint-williams-cathedral-lafia', name: 'Saint Williams Cathedral, Lafia', kind: 'church', lon: 8.51985, lat: 8.50327, localUnitId: 'lafia',
      description: 'A Wikidata point for Saint Williams Cathedral, classed there as a cathedral.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q116724126' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'john-castle-lafia', name: 'John Castle', kind: 'heritage', lon: 8.543472, lat: 8.5196432, localUnitId: 'lafia',
      description: 'A mapped historic castle-type building tagged John Castle in Lafia.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 9931543217 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree'], landmark: 'gate' },
    },
    {
      id: 'lafia-market', name: 'Lafia Market', kind: 'market', lon: 8.514427, lat: 8.493531, localUnitId: 'lafia',
      description: 'A Wikidata point for Lafia Market; Wikipedia says the Lafia market became one of the most important in the Benue Valley under Mohamman Agwai and calls modern Lafia a collecting point and trading centre for farm produce.', sourceIds: ['wikidata-selected', 'wikipedia-lafia'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q108702783' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['lafia-sesame-soybean-trade', 'lafia-yam-sorghum-millet'],
    },
    {
      id: 'lafia-new-market', name: 'New market', kind: 'market', lon: 8.5367787, lat: 8.566044, localUnitId: 'lafia',
      description: 'A Wikidata point for New market, described there as a commercial area; its goods are not sourced, so it shows the produce Wikipedia attributes to Lafia trade.', sourceIds: ['wikidata-selected', 'wikipedia-lafia'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q130724917' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['lafia-yam-sorghum-millet'],
    },
  ],
  identity: {
    foods: [
      { id: 'lafia-yam-sorghum-millet', name: 'Yams, sorghum and millet', description: 'Wikipedia calls modern Lafia a trading centre for yams, sorghum, millet and cotton.', sourceIds: ['wikipedia-lafia'] },
    ],
    crafts: [
      { id: 'lafia-cotton-weaving-dyeing', name: 'Cotton weaving and dyeing', description: "Wikipedia says cotton weaving and dyeing are traditionally important activities of Lafia's inhabitants.", sourceIds: ['wikipedia-lafia'] },
    ],
    industries: [
      { id: 'lafia-sesame-soybean-trade', name: 'Sesame and soybean collecting point', description: 'Wikipedia calls modern Lafia a collecting point for sesame seeds and soybeans.', sourceIds: ['wikipedia-lafia'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'middle-belt-wet-dry', rainyMonths: [4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3],
    description: 'A Middle Belt tropical savanna climate (Aw) with a rainy season from April to October and a dry season from November to March.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-lafia'],
  },
  homePalette: { back: '#8e9fc2', left: '#4d5c82', floor: ['#c9b99a', '#7b8f5e'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/lafia-surface.geojson', bytes: 146886, sha256: '9c69532adca6aca60dde4a00f40c2b3ec1cdc6f9ef599b47c139e537c9190008' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Lafia', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/lafia/reviewed/osm-selected.json', bytes: 1825, sha256: '8767542b46aeb7bfae70219e43eabf8ab54f10224f514e4c89e2cd07301e0c62' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Lafia', url: 'https://www.wikidata.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/lafia/reviewed/wikidata-selected.json', bytes: 10085, sha256: 'f2b4aa8796f3b088b78fa4b394215abf7705479c4c267437546b39aa5ba125fe' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/lafia/reviewed/geography.json', bytes: 348, sha256: '79e7ebda7a8312d4a9aff1b23b78dbde06fa4c4560d2a1e437dbc4d6ac208e15' } },
    { id: 'wikipedia-lafia', title: 'Lafia (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lafia', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/lafia/reviewed/wikipedia-lafia.json', bytes: 1125, sha256: '957e15f9b91370fa6ee54416b422e60764a6465c74d95372aa5335cebc2d12a0' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'No named eatery with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'mosque', note: 'No named mosque with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06; the Lafia Central Mosque in Wikipedia has no such point.' },
    { kind: 'park', note: 'No named park with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'road-hub', note: 'No named bus station, motor park or terminal with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No named salon with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'savings', note: 'No named savings institution or commercial bank branch with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06; the only bank-tagged element is the Central Bank of Nigeria.' },
  ],
})
