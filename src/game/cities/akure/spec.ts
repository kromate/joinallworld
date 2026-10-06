import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'akure',
  name: 'Akure',
  state: { id: 'ondo', name: 'Ondo', sourceName: 'Ondo', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 5.1932647,
    lat: 7.2525595,
    teaser: 'Cocoa and yam trade, the Deji palace and the university of the Ondo State capital.',
    preview: ['Visit the central markets and the Alagbaka district.', 'Cross the city through Akure South and North.'],
    coordinateSourceId: 'osm-selected',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 501540926 },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-akure'], note: 'Wikipedia reports 403,000 residents at the 2006 census and an undated current estimate of 774,000.' },
  localUnits: [
    { id: 'akure-south', name: 'Akure South', sourceName: 'Akure South', populationTier: 'city', description: 'The selected southern local government contains the central markets, the cathedral, the stadium and the bus terminal.', sourceIds: ['geography'] },
    { id: 'akure-north', name: 'Akure North', sourceName: 'Akure North', populationTier: 'small-city', description: 'The selected northern local government contains the Ministry of Information and the Igbatoro Road lounge.', sourceIds: ['geography'] },
    { id: 'ifedore', name: 'Ifedore', sourceName: 'Ifedore', populationTier: 'town', description: 'The selected local government contains the Federal University of Technology Akure campus.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-davids-cathedral', name: "St. David's Cathedral", kind: 'church', lon: 5.1988484, lat: 7.2554413, localUnitId: 'akure-south',
      description: "A mapped church named St. David's Cathedral on Ijomu Street.", sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 823271399 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'akure-central-mosque', name: 'Akure Central Mosque', kind: 'mosque', lon: 5.1958901, lat: 7.2536222, localUnitId: 'akure-south',
      description: 'A mapped mosque named Akure Central Mosque on Oba Adesida Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837276072 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'chicken-republic-akure', name: 'Chicken Republic', kind: 'eatery', lon: 5.211737, lat: 7.2507273, localUnitId: 'akure-south',
      description: "A mapped fast-food restaurant named Chicken Republic on Oba Adesida Road; Wikivoyage lists it in Alagbaka as selling local and continental dishes. Its featured dish is the Eat section's city-level grilled pepper chicken, not a menu source.", sourceIds: ['osm-selected', 'wikivoyage-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 482492352 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] }, featuredIdentityId: 'grilled-pepper-chicken',
    },
    {
      id: 'ministry-of-justice', name: 'Ministry of Justice', kind: 'government', lon: 5.2038929, lat: 7.2493308, localUnitId: 'akure-south',
      description: 'A mapped government office named Ministry of Justice along NEPA Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7818287731 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'ministry-of-information', name: 'Ministry of Information', kind: 'government', lon: 5.2168845, lat: 7.2408121, localUnitId: 'akure-north',
      description: 'A mapped government office named Ministry of Information in Akure North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 11243844076 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'first-mercy-specialist-hospital', name: 'First Mercy Specialist Hospital', kind: 'hospital', lon: 5.1827604, lat: 7.2536556, localUnitId: 'akure-south',
      description: 'A mapped hospital named First Mercy Specialist Hospital; Wikipedia lists it among the hospitals of Akure.', sourceIds: ['osm-selected', 'wikipedia-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1296015365 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'akure-market', name: 'Akure Market', kind: 'market', lon: 5.19561, lat: 7.25289, localUnitId: 'akure-south',
      description: 'A mapped marketplace named Akure Market. Its specialty link is the regional farm-produce trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 6271074305 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['akure-farm-produce'],
    },
    {
      id: 'erekesan-market', name: 'Erekesan Market', kind: 'market', lon: 5.1953067, lat: 7.2533095, localUnitId: 'akure-south',
      description: 'A mapped marketplace named Erekesan Market. Its specialty link is the regional farm-produce trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837276070 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['akure-farm-produce'],
    },
    {
      id: 'isikan-market', name: 'Isikan Market', kind: 'market', lon: 5.1825206, lat: 7.2508457, localUnitId: 'akure-south',
      description: 'A mapped marketplace named Isikan Market. Its specialty link is the regional farm-produce trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7814299181 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['akure-farm-produce'],
    },
    {
      id: 'first-bank-akure', name: 'First Bank of Nigeria', kind: 'savings', lon: 5.197288, lat: 7.2519821, localUnitId: 'akure-south',
      description: 'A mapped bank named First Bank Of Nigeria in Akure South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837679744 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'akure-sports-stadium', name: 'Akure Sports Stadium', kind: 'stadium', lon: 5.1896289, lat: 7.2585014, localUnitId: 'akure-south',
      description: 'A mapped stadium named Akure Sports Stadium in Akure South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 471941220 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'ondo-state-bus-terminal', name: 'Ondo State Bus Terminal', kind: 'road-hub', lon: 5.1746638, lat: 7.2611849, localUnitId: 'akure-south',
      description: 'A mapped bus station and public-transport station named Ondo State Bus Terminal on Oba Adesida Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837276050 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'holy-mary-statue', name: 'Holy Mary Statue', kind: 'heritage', lon: 5.1892561, lat: 7.2551019, localUnitId: 'akure-south',
      description: 'A mapped artwork named Holy Mary Statue in Akure South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7818287637 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'ondo-state-library', name: 'Ondo State Library', kind: 'civic-landmark', lon: 5.1833338, lat: 7.2569591, localUnitId: 'akure-south',
      description: 'A mapped library named Ondo State Library in Akure South.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837679742 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'futa', name: 'Federal University of Technology Akure', kind: 'university', lon: 5.1314576, lat: 7.3040911, localUnitId: 'ifedore',
      description: 'A mapped university named Federal University of Technology Akure, in Ifedore; Wikivoyage names it as a respected university of the city.', sourceIds: ['osm-selected', 'wikivoyage-akure'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 711995935 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
  ],
  identity: {
    foods: [
      { id: 'grilled-pepper-chicken', name: 'Grilled pepper chicken', description: 'Wikivoyage names grilled pepper chicken among the dishes served by Akure restaurants and eateries.', sourceIds: ['wikivoyage-akure'] },
      { id: 'akure-farm-produce', name: 'Cocoa, yam and cassava', description: 'Wikipedia calls Akure the trading avenue of a farming region growing cocoa, yam, cassava, maize and tobacco.', sourceIds: ['wikipedia-akure'] },
    ],
    crafts: [
      { id: 'akure-cloth-weaving', name: 'Cotton cloth weaving', description: 'Wikipedia says cotton is grown around Akure and used to weave cloth.', sourceIds: ['wikipedia-akure'] },
    ],
    industries: [
      { id: 'akure-farm-trade', name: 'Farm-produce trade', description: 'Wikipedia calls Akure the trading avenue for a farming region and notes an annual trade fair run by the Ondo State Agricultural Commodities Association.', sourceIds: ['wikipedia-akure'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry', rainyMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], dryMonths: [12, 1],
    description: 'A tropical humid climate with 2,548 mm of yearly rain; the rainy season runs from early February to late November and January is the driest month.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-akure'],
  },
  homePalette: { back: '#b7c4a8', left: '#5d7048', floor: ['#c9b27c', '#4f6b3f'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/akure-surface.geojson', bytes: 192768, sha256: '9944107fb611ea9c3fdc53ba5725adbc0601e192166788f01c64c98ca02ba1ed' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Akure', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/akure/reviewed/osm-selected.json', bytes: 4336, sha256: 'ccfb4698b9fb876103eaeb18e09c2afae41e7befc82e8b447422d227d3e1bdab' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/akure/reviewed/geography.json', bytes: 440, sha256: '56d2ad7d04f21433c3ca3e64e150dabab461e0b7a3171016a5bd860b49c3de20' } },
    { id: 'wikipedia-akure', title: 'Akure (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Akure', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/akure/reviewed/wikipedia-akure.json', bytes: 798, sha256: '0ea4f8a1310555cde33251a1dd6bc7fb632b7460aad7800f38595f2ecb79e00c' } },
    { id: 'wikivoyage-akure', title: 'Akure (Wikivoyage)', url: 'https://en.wikivoyage.org/wiki/Akure', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/akure/reviewed/wikivoyage-akure.json', bytes: 523, sha256: 'b109c532db9b50e2302feef79d15974baac781d0e075bfbec558054b9e3103f9' } },
  ],
  unmapped: [
    { kind: 'salon', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'garden', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'park', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
