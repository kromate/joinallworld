import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'ilorin',
  name: 'Ilorin',
  state: { id: 'kwara', name: 'Kwara', sourceName: 'Kwara', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 4.55,
    lat: 8.5,
    teaser: 'Pottery, aso-oke weaving and old markets in the capital of Kwara State.',
    preview: ["Visit Oja Oba and the Emir's Palace.", 'Cross the city through Ilorin West, East and South.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q587085' },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-ilorin'], note: "Wikipedia reports 777,667 residents at the 2006 census; the figure is that article's dated count." },
  localUnits: [
    { id: 'ilorin-west', name: 'Ilorin West', sourceName: 'Ilorin West', populationTier: 'city', description: 'The selected western local government contains the Kankatu mosque, Oja Oba, the teaching hospital and the state stadium.', sourceIds: ['geography'] },
    { id: 'ilorin-east', name: 'Ilorin East', sourceName: 'Ilorin East', populationTier: 'city', description: "The selected eastern local government contains Government House, the Emir's Palace and the national museum.", sourceIds: ['geography'] },
    { id: 'ilorin-south', name: 'Ilorin South', sourceName: 'Ilorin South', populationTier: 'city', description: 'The selected southern local government contains Ipata Market, the University of Ilorin and Tanke eateries.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-james-catholic-church', name: "St James' Catholic Church", kind: 'church', lon: 4.5685007, lat: 8.4910603, localUnitId: 'ilorin-east',
      description: "A mapped Christian place of worship named St James' Catholic Church in Ilorin East.", sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13048283369 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'kankatu-central-mosque', name: 'Kankatu Central Mosque', kind: 'mosque', lon: 4.5419569, lat: 8.4807161, localUnitId: 'ilorin-west',
      description: 'A mapped Muslim place of worship named Kankatu Central Mosque in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974843 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'flower-garden', name: 'Flower Garden', kind: 'garden', lon: 4.5819063, lat: 8.4867204, localUnitId: 'ilorin-east',
      description: 'A mapped garden named Flower Garden in Ilorin East.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974979 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'diamond-park', name: 'Diamond Park', kind: 'park', lon: 4.5414969, lat: 8.4545491, localUnitId: 'ilorin-west',
      description: 'A mapped public park named Diamond Park in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13048286722 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'kwara-government-house', name: 'Kwara State Government House', kind: 'government', lon: 4.5810537, lat: 8.480534, localUnitId: 'ilorin-east',
      description: 'A mapped government office named Kwara State Government House in Ilorin East.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974832 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'uith', name: 'University of Ilorin Teaching Hospital', kind: 'hospital', lon: 4.5321749, lat: 8.4796499, localUnitId: 'ilorin-west',
      description: 'A mapped hospital named University of Ilorin Teaching Hospital in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 400461278 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'oja-oba', name: 'Oja Oba', kind: 'market', lon: 4.5459987, lat: 8.4959867, localUnitId: 'ilorin-west',
      description: 'A mapped marketplace named Oja Oba in Ilorin West. Its specialty link is the city-wide aso-oke trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-ilorin'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974785 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['aso-oke-weaving'],
    },
    {
      id: 'ipata-market', name: 'Ipata Market', kind: 'market', lon: 4.5616065, lat: 8.4993041, localUnitId: 'ilorin-south',
      description: "A mapped marketplace named Ipata Market; Wikivoyage lists it among Ilorin's outdoor local markets. Its specialty link is the city-wide pottery trade.", sourceIds: ['osm-selected', 'wikivoyage-ilorin', 'wikipedia-ilorin'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974859 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['ilorin-pottery'],
    },
    {
      id: 'kankatu-market', name: 'Kankatu Market', kind: 'market', lon: 4.5464478, lat: 8.5063938, localUnitId: 'ilorin-east',
      description: 'A mapped marketplace named Kankatu Market on Okelele Road, in the Okelele area that Wikipedia names for traditional pottery workshops.', sourceIds: ['osm-selected', 'wikipedia-ilorin'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974842 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['ilorin-pottery'],
    },
    {
      id: 'take-beauty-salon', name: 'Take Beauty Salon', kind: 'salon', lon: 4.6067893, lat: 8.4855297, localUnitId: 'ilorin-south',
      description: 'A mapped hairdresser named Take Beauty Salon in Ilorin South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974717 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'zenith-bank-unity-road', name: 'Zenith Bank', kind: 'savings', lon: 4.561065, lat: 8.4800223, localUnitId: 'ilorin-west',
      description: 'A mapped bank named Zenith Bank on Unity Road in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13048283339 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'kwara-state-stadium', name: 'Kwara State Stadium', kind: 'stadium', lon: 4.5421773, lat: 8.4756211, localUnitId: 'ilorin-west',
      description: 'A mapped stadium named Kwara State Stadium in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 170728987 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'soludero-bus-terminal', name: 'Soludero Bus Terminal', kind: 'road-hub', lon: 4.5644774, lat: 8.487369, localUnitId: 'ilorin-east',
      description: 'A mapped bus station and public-transport station on Muritala Muhamed Way.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13047974726 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'university-of-ilorin', name: 'University of Ilorin', kind: 'university', lon: 4.6577393, lat: 8.4765988, localUnitId: 'ilorin-south',
      description: 'A mapped university named University of Ilorin in Ilorin South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1482800400 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'al-hikmah-university', name: 'Al-Hikmah University', kind: 'university', lon: 4.504361, lat: 8.4814067, localUnitId: 'ilorin-west',
      description: 'A mapped university named Al-Hikmah University in Ilorin West.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 589644243 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ilorin-national-museum', name: 'Ilorin National Museum', kind: 'museum', lon: 4.584396, lat: 8.4821616, localUnitId: 'ilorin-east',
      description: 'A mapped museum named Ilorin National Museum in Ilorin East.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1036276640 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'emirs-palace', name: "Emir's Palace", kind: 'heritage', lon: 4.5498702, lat: 8.4958215, localUnitId: 'ilorin-east',
      description: "A mapped historic castle tagged as the Emir of Ilorin's Palace on Surulere Road; Wikivoyage lists the Emir palace as a sight.", sourceIds: ['osm-selected', 'wikivoyage-ilorin'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13048286714 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'tuwo', name: 'Tuwo', description: 'Wikivoyage lists a tuwo spot in Ilorin selling Nigerian traditional foods.', sourceIds: ['wikivoyage-ilorin'] },
    ],
    crafts: [
      { id: 'ilorin-pottery', name: 'Ilorin pottery', description: 'Wikipedia describes pottery as a major business in Ilorin, with traditional workshops in Okelele, Oju-Ekun, Okekura, Oloje, Abe Emi and Ita Merin.', localProductId: 'clay-pot', sourceIds: ['wikipedia-ilorin'] },
      { id: 'aso-oke-weaving', name: 'Aso-oke weaving', description: 'Wikipedia records aso-oke, textiles hand-woven on simple looms, made in large quantities across Ilorin.', localProductId: 'aso-oke', sourceIds: ['wikipedia-ilorin'] },
    ],
    industries: [
      { id: 'ilorin-manufacturing', name: 'Flour, soap and detergent manufacturing', description: "Wikipedia names Global Soap, Detergent Industries Nigeria Limited and Dangote Flour Mills among Kwara's industrial companies.", localProductId: 'soap', sourceIds: ['wikipedia-ilorin'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'middle-belt-wet-dry', rainyMonths: [4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3],
    description: 'A tropical savanna climate with 990 to 1,318 mm of yearly rain, a wet season from April to October and March as the hottest month.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-ilorin', 'wikivoyage-ilorin'],
  },
  homePalette: { back: '#d2a679', left: '#8b5e3c', floor: ['#c8a165', '#5f7a4e'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/ilorin-surface.geojson', bytes: 225190, sha256: 'c9476af44bd9d3ad1b0c343533e9d0ea7e0096ace274dbeaf767c834b9ac6e06' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Ilorin', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/ilorin/reviewed/osm-selected.json', bytes: 4558, sha256: '4b7977b39506fa52b818c467d10a09eecd25c1d86169fd57453b87601199bb4f' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Ilorin', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/ilorin/reviewed/wikidata-selected.json', bytes: 1094, sha256: '0a221353d298c7bf1adbedde4a73169a62a76f8731fa57ea4445928a320eb980' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/ilorin/reviewed/geography.json', bytes: 452, sha256: '07e28064d8a06e55d3ef357b47bad281b320400b45e015ca51bd56b96f49e3dd' } },
    { id: 'wikipedia-ilorin', title: 'Ilorin (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Ilorin', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/ilorin/reviewed/wikipedia-ilorin.json', bytes: 784, sha256: '284e3ebec8b44544b1945b402082abdad872cfcb0ac45dc232cb6091f173563b' } },
    { id: 'wikivoyage-ilorin', title: 'Ilorin (Wikivoyage)', url: 'https://en.wikivoyage.org/wiki/Ilorin', checkedOn: '2026-10-06', supports: ['identity', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/ilorin/reviewed/wikivoyage-ilorin.json', bytes: 542, sha256: '8f93a3ddb4404c8853590cfc5e5f7a10ab27538f2a04d911bbdb8b854c8a488a' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
