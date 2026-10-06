import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'makurdi',
  name: 'Makurdi',
  state: { id: 'benue', name: 'Benue', sourceName: 'Benue', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 8.5361111111111,
    lat: 7.7305555555556,
    teaser: 'The Benue River capital of the Middle Belt, with farm-produce markets on both banks.',
    preview: ['Visit Wurukum and North Bank markets.', 'Cross the city through the Makurdi local government.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q994096' },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-makurdi'], note: 'Wikipedia gives 517,342 for 2022, an urban trend figure from the National Population Commission.' },
  localUnits: [
    { id: 'makurdi', name: 'Makurdi', sourceName: 'Makurdi', populationTier: 'city', description: 'The selected local government contains the markets, the universities, the hospitals and the stadium.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'benue-ministry-of-information-culture-tourism', name: 'Benue State Ministry of Information, Culture & Tourism', kind: 'government', lon: 8.5229381, lat: 7.7141953, localUnitId: 'makurdi',
      description: 'A Wikidata government-agency record for the Benue State Ministry of Information, Culture & Tourism.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q130458797' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'bsu-teaching-hospital', name: 'Benue State University Teaching Hospital', kind: 'hospital', lon: 8.5684491, lat: 7.7252404, localUnitId: 'makurdi',
      description: 'A Wikidata hospital record for the Benue State University Teaching Hospital.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q132181357' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'federal-medical-centre-makurdi', name: 'Federal Medical Centre Makurdi', kind: 'hospital', lon: 8.5179091, lat: 7.7374082, localUnitId: 'makurdi',
      description: 'A Wikidata medical-centre record named Federal Medical Centre Makurdi.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q105644487' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'benue-state-university', name: 'Benue State University', kind: 'university', lon: 8.556275, lat: 7.726538, localUnitId: 'makurdi',
      description: 'A Wikidata university record for Benue State University.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q4890689' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'university-of-agriculture-makurdi', name: 'University of Agriculture, Makurdi', kind: 'university', lon: 8.5391474, lat: 7.7321865, localUnitId: 'makurdi',
      description: 'A Wikidata university record for the University of Agriculture, Makurdi.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q7895023' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'dajo-pottery', name: 'Dajo Pottery', kind: 'heritage', lon: 8.586733, lat: 7.715693, localUnitId: 'makurdi',
      description: 'A Wikidata record for Dajo Pottery, described as a Benue tourist attraction and tagged with pottery as its subject.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q135420897' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'roadside', props: ['tree'] },
    },
    {
      id: 'makurdi-central-mosque', name: 'Makurdi Central Mosque', kind: 'mosque', lon: 8.513326, lat: 7.742895, localUnitId: 'makurdi',
      description: 'A Wikidata mosque record for the Makurdi Central Mosque.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125373234' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'first-baptist-church-makurdi', name: 'First Baptist Church Makurdi', kind: 'church', lon: 8.522621, lat: 7.739296, localUnitId: 'makurdi',
      description: 'A Wikidata Baptist church record named First Baptist Church Makurdi.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125464042' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'our-lady-of-perpetual-help-cathedral', name: 'Our Lady of Perpetual Help Cathedral', kind: 'church', lon: 8.50494, lat: 7.71756, localUnitId: 'makurdi',
      description: 'A Wikidata cathedral record named Our Lady of Perpetual Help Cathedral.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q123054274' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'wurukum-market', name: 'Wurukum market', kind: 'market', lon: 8.5529289, lat: 7.7247534, localUnitId: 'makurdi',
      description: 'A Wikidata market record for Wurukum market; Nigeria Galleria calls it a large daily market where farmers bring raw produce to sell at cheap rates.', sourceIds: ['wikidata-selected', 'nigeriagalleria-benue-markets'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q108548209' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['makurdi-farm-produce'],
    },
    {
      id: 'north-bank-market', name: 'North bank market', kind: 'market', lon: 8.5464724, lat: 7.7543618, localUnitId: 'makurdi',
      description: 'A Wikidata market record for North bank market; Nigeria Galleria lists fresh farm produce, clothes and shoes, home wares, building materials and cosmetics.', sourceIds: ['wikidata-selected', 'nigeriagalleria-benue-markets'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q108548105' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['makurdi-farm-produce'],
    },
    {
      id: 'aper-aku-stadium', name: 'Aper Aku Stadium', kind: 'stadium', lon: 8.5180556, lat: 7.7416667, localUnitId: 'makurdi',
      description: 'A Wikidata stadium record for Aper Aku Stadium.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q618215' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'zion-microfinance-bank', name: 'Zion Microfinance Bank Limited', kind: 'savings', lon: 8.5105528, lat: 7.737717, localUnitId: 'makurdi',
      description: 'A Wikidata microfinance-bank record for Zion Microfinance Bank Limited.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q110986571' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'golden-plate-restaurant', name: 'Golden Plate Restaurant', kind: 'eatery', lon: 8.538186, lat: 7.72329, localUnitId: 'makurdi',
      description: 'A Wikidata restaurant record for Golden Plate Restaurant; the featured dish is a state-level Benue cuisine item, not a menu record.', sourceIds: ['wikidata-selected', 'nico-benue-cuisine'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q131298281' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['stall'] }, featuredIdentityId: 'benue-pounded-yam',
    },
  ],
  identity: {
    foods: [
      { id: 'makurdi-farm-produce', name: 'Fresh farm produce', description: 'Nigeria Galleria says farmers bring raw produce to Wurukum market and that North Bank Market sells fresh farm produce and food items.', sourceIds: ['nigeriagalleria-benue-markets'] },
      { id: 'benue-pounded-yam', name: 'Pounded Yam', description: 'The NICO Benue State cuisine list names Pounded Yam first among Benue dishes.', sourceIds: ['nico-benue-cuisine'], note: 'State-level cuisine list, not specific to Makurdi.' },
    ],
    crafts: [
      { id: 'dajo-pottery-craft', name: 'Pottery at Dajo', description: 'A Wikidata record describes Dajo Pottery as a Benue tourist attraction with pottery as its subject.', sourceIds: ['wikidata-selected'], note: 'Wikidata record only; no article text describing the pottery was found.' },
    ],
    industries: [
      { id: 'makurdi-trade-agriculture', name: 'Trade and agriculture', description: 'Wikipedia says the Makurdi economy is driven by trade and agriculture, and lists MIVA rice and Oracle farms and feed mills among major agricultural companies.', sourceIds: ['wikipedia-makurdi'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'middle-belt-wet-dry', rainyMonths: [4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3],
    description: 'A warm Benue-valley climate with rain concentrated from April to October, near-dry months from November to March and a cooler harmattan from November to January.',
    clearLabel: 'Clear dry-season skies', harmattan: { months: [11, 12, 1], label: 'Cool harmattan haze' }, sourceIds: ['wikipedia-makurdi'],
  },
  homePalette: { back: '#d1a05f', left: '#8a5c2e', floor: ['#c9b987', '#7a9a4f'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/makurdi-surface.geojson', bytes: 385520, sha256: '009956df3a6020e09673ed9daa7cbae9520108833da19f32dbc5fd598b8f8b0d' } },
  sourceGroups: [
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Makurdi', url: 'https://www.wikidata.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/makurdi/reviewed/wikidata-selected.json', bytes: 28109, sha256: 'e083039611b420a6834148d9abe01b13d65510ae21044d13748b39992483ec53' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/makurdi/reviewed/geography.json', bytes: 346, sha256: '1a129de19625745649e660e5cadb1615b05745609782704d929a569f7bc76332' } },
    { id: 'wikipedia-makurdi', title: 'Makurdi (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Makurdi', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/makurdi/reviewed/wikipedia-makurdi.json', bytes: 918, sha256: '3f5a149318070c0948b349a9d93d91a1e123f6fef273f2700a710a435b992c45' } },
    { id: 'nigeriagalleria-benue-markets', title: 'Popular Markets in Benue State (Nigeria Galleria)', url: 'https://www.nigeriagalleria.com/Nigeria/States_Nigeria/Benue/Popular-Markets-in-Benue-State.html', checkedOn: '2026-10-06', supports: ['identity'], cache: { path: 'scripts/city/research/makurdi/reviewed/nigeriagalleria-benue-markets.json', bytes: 540, sha256: 'b09add1d6e34f3ca7fa281e4ae8e8128e69c463c31c1277697cc1eabda9ecc96' } },
    { id: 'nico-benue-cuisine', title: 'Cuisines in Nigeria (NICO)', url: 'https://nico.gov.ng/cuisines-in-nigeria/', checkedOn: '2026-10-06', supports: ['identity'], cache: { path: 'scripts/city/research/makurdi/reviewed/nico-benue-cuisine.json', bytes: 341, sha256: 'ee7771a44bee877dde82decdb512cfa491169a65368d9f8e81cf103586097870' } },
  ],
  unmapped: [
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'park', note: 'No named park with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06; the Makurdi zoo record was not promoted to a park.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'road-hub', note: 'No named bus station, motor park or terminal with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No salon-tagged OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
  ],
})
