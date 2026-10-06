import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'abakaliki',
  name: 'Abakaliki',
  state: { id: 'ebonyi', name: 'Ebonyi', sourceName: 'Ebonyi', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 8.1133202,
    lat: 6.3208897,
    teaser: 'The Ebonyi capital, a rice-trading city with a Catholic cathedral and a township stadium.',
    preview: ['Visit St. Theresa\'s Cathedral and the National Museum.', 'Browse the Abakaliki Rice Processing Market.'],
    coordinateSourceId: 'osm-selected',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 501540903 },
  },
  population: { tier: 'city', sourceIds: ['abakaliki-wiki'], note: 'The cited article gives 223,000 residents for 2022 and a 2023 metro estimate of 662,000.' },
  localUnits: [
    { id: 'abakaliki', name: 'Abakaliki', sourceName: 'Abakaliki', populationTier: 'town', description: 'The selected Abakaliki local government contains the cathedral, the motor park, the rice market and two bank and restaurant records.', sourceIds: ['geography'] },
    { id: 'ebonyi', name: 'Ebonyi', sourceName: 'Ebonyi', populationTier: 'city', description: 'The selected Ebonyi local government contains the Abakaliki city point, the teaching hospital, the township stadium and the national museum.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-theresas-cathedral-abakaliki', name: 'St. Theresa\'s Cathedral', kind: 'church', lon: 8.1172718, lat: 6.3181, localUnitId: 'abakaliki',
      description: 'A mapped Catholic place of worship named St. Theresa\'s Cathedral; Wikipedia records the city as the seat of the Roman Catholic Diocese of Abakaliki.', sourceIds: ['osm-selected', 'abakaliki-wiki'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 669564628 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'crunchies-restaurant-abakaliki', name: 'Crunchies Restaurant', kind: 'eatery', lon: 8.1068702, lat: 6.313528, localUnitId: 'abakaliki',
      description: 'A mapped restaurant named Crunchies Restaurant, shown here with Abakaliki rice.', sourceIds: ['osm-selected', 'abakaliki-rice'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1184098761 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] }, featuredIdentityId: 'abakaliki-rice',
    },
    {
      id: 'federal-teaching-hospital-abakaliki', name: 'Federal Teaching Hospital Abakaliki', kind: 'hospital', lon: 8.0922109, lat: 6.3209559, localUnitId: 'ebonyi',
      description: 'A mapped hospital named Federal Teaching Hospital Abakaliki.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 569464466 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'capital-medicare-abakaliki', name: 'Capital Medicare', kind: 'hospital', lon: 8.1242703, lat: 6.3242975, localUnitId: 'abakaliki',
      description: 'A mapped hospital named Capital Medicare.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 10310555696 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'ebonyi-ministry-of-works', name: 'Ministry of Works', kind: 'government', lon: 8.1086003, lat: 6.3293037, localUnitId: 'ebonyi',
      description: 'A mapped government office named Ministry of Works.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 628928384 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'], landmark: 'gate' },
    },
    {
      id: 'abakaliki-township-stadium', name: 'Abakaliki Township Stadium', kind: 'stadium', lon: 8.0999519, lat: 6.3301469, localUnitId: 'ebonyi',
      description: 'A mapped stadium named Abakaliki Township Stadium.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 669570802 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'], landmark: 'tower' },
    },
    {
      id: 'fatilami-park', name: 'Fatilami Park', kind: 'park', lon: 8.102125, lat: 6.327472, localUnitId: 'ebonyi',
      description: 'A mapped public park named Fatilami Park.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'relation', id: 12665945 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'zenith-bank-ogoja-road-abakaliki', name: 'Zenith Bank Ogoja Road', kind: 'savings', lon: 8.1127654, lat: 6.3187478, localUnitId: 'abakaliki',
      description: 'A mapped bank branch named Zenith Bank Ogoja Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 5430665157 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'first-bank-abakaliki', name: 'First Bank', kind: 'savings', lon: 8.1102482, lat: 6.3245334, localUnitId: 'ebonyi',
      description: 'A mapped bank branch named First Bank.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 10303744169 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'abakaliki-rice-processing-market', name: 'Abakaliki Rice Processing Market', kind: 'market', lon: 8.1346134, lat: 6.3178141, localUnitId: 'abakaliki',
      description: 'A mapped marketplace named Abakaliki Rice Processing Market; its name and the Abakaliki rice article tie it to rice.', sourceIds: ['osm-selected', 'abakaliki-rice'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13052463573 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['abakaliki-rice'],
    },
    {
      id: 'itc-motor-park-abakaliki', name: 'ITC Motor Park Abakaliki', kind: 'road-hub', lon: 8.1111697, lat: 6.3176676, localUnitId: 'abakaliki',
      description: 'A mapped commercial area named ITC Motor Park Abakaliki.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 567685706 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'blessed-martins-college-of-nursing-sciences', name: 'Blessed Martins College of Nursing Sciences', kind: 'college', lon: 8.1063481, lat: 6.313729899999999, localUnitId: 'ebonyi',
      description: 'Wikidata records Blessed Martins College of Nursing Sciences as a college of nursing with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q137910241' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'lamp'] },
    },
    {
      id: 'national-museum-abakaliki', name: 'National Museum, Abakaliki', kind: 'museum', lon: 8.097031291946566, lat: 6.3355105536679375, localUnitId: 'ebonyi',
      description: 'Wikidata records the National Museum, Abakaliki as a museum in Ebonyi State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q111904974' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ebonyi-state-library-board', name: 'Ebonyi State Library Board', kind: 'civic-landmark', lon: 8.11187, lat: 6.31058, localUnitId: 'abakaliki',
      description: 'Wikidata records the Ebonyi State Library Board as a public library with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q68652114' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['bench', 'planter'] },
    },
  ],
  identity: {
    foods: [
      { id: 'abakaliki-rice', name: 'Abakaliki rice', description: 'Wikipedia describes Abakaliki rice as rice grown predominantly in Ebonyi State and named after the state capital, used in a wide range of dishes.', sourceIds: ['abakaliki-rice'] },
    ],
    crafts: [
      { id: 'ntezi-baskets', name: 'Ntezi baskets', description: 'Wikipedia lists locally hand-made baskets of various sizes at Ntezi as a minor industry of Ebonyi State.', sourceIds: ['ebonyi-wiki'] },
    ],
    industries: [
      { id: 'abakaliki-agriculture-mining', name: 'Farm trade and quarrying', description: 'Wikipedia describes Abakaliki as a centre of agricultural trade in yams, cassava, rice and palm products, with local lead, zinc, salt and limestone mining or quarrying.', sourceIds: ['abakaliki-wiki'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry', rainyMonths: [3, 4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2],
    description: 'Ebonyi State has a humid tropical climate with one eight-month rainy season and one four-month dry season, and harmattan winds are common in December and January.',
    clearLabel: 'Dry-season sky', sourceIds: ['ebonyi-wiki'], harmattan: { months: [12, 1], label: 'Harmattan haze' },
  },
  homePalette: { back: '#b7876b', left: '#74503f', floor: ['#cdb27c', '#66805c'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/abakaliki-surface.geojson', bytes: 154895, sha256: '4f971f47c4195569bd7df9b2c5f8ebe174c0d260f69acfae9b1eca89699fb777' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Abakaliki', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/osm-selected.json', bytes: 3466, sha256: 'f78dd23c6ab4f1da087b98b8cc81942fefe9879f9417cff4be245c9b8789ffd7' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Abakaliki', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/wikidata-selected.json', bytes: 2706, sha256: '5d2ba83e0e1b9cc324cc86c033d07e9a11f147fb1c1d4e62847dfa38b3611973' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/geography.json', bytes: 390, sha256: '593b201506b17c7f5cf722ea55371da37a6328449bec8ab163e37fc4be9ce6ff' } },
    { id: 'abakaliki-wiki', title: 'Wikipedia: Abakaliki', url: 'https://en.wikipedia.org/wiki/Abakaliki', checkedOn: '2026-10-06', supports: ['population', 'identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/abakaliki-wiki.json', bytes: 582, sha256: '46ef87fbf71431a64d4d49ddb54f4b3e3b3b6f2a2c99399a719a8da02f81cc60' } },
    { id: 'ebonyi-wiki', title: 'Wikipedia: Ebonyi State', url: 'https://en.wikipedia.org/wiki/Ebonyi_State', checkedOn: '2026-10-06', supports: ['climate', 'identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/ebonyi-wiki.json', bytes: 565, sha256: 'd8ee799f3e3b7d49a865ae33f038d8b38d763d19bc73366de7b2d9a7f3b1f4e1' } },
    { id: 'abakaliki-rice', title: 'Wikipedia: Abakaliki rice', url: 'https://en.wikipedia.org/wiki/Abakaliki_rice', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/abakaliki/reviewed/abakaliki-rice.json', bytes: 297, sha256: 'deb233cdd3968aa3f361de2f6e9029c28821d8d622bca96eb077f18e27cdfcc6' } },
  ],
  unmapped: [
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'mosque', note: 'No named mosque with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No named salon or barber shop with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
  ],
})
