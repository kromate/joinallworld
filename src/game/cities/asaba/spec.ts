import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'asaba',
  name: 'Asaba',
  state: { id: 'delta', name: 'Delta', sourceName: 'Delta', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 6.7297071,
    lat: 6.1858825,
    teaser: 'The Delta State capital on the west bank of the Niger, facing Onitsha, with a busy modern market.',
    preview: ['Visit Ogbe-Ogonogo Market and the National Museum in the Mungo Park house.', 'Cross the city through Oshimili South and Oshimili North.'],
    coordinateSourceId: 'osm-selected',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 501540929 },
  },
  population: { tier: 'small-city', sourceIds: ['wikipedia-asaba'], note: 'Wikipedia gives 149,603 at the 2006 census; the city is described as growing quickly since then.' },
  localUnits: [
    { id: 'oshimili-north', name: 'Oshimili North', sourceName: 'Oshimili North', populationTier: 'small-city', description: 'The northern local government holds the federal secretariat, the airport, the Ibusa hospital and Holy Family Catholic church.', sourceIds: ['geography'] },
    { id: 'oshimili-south', name: 'Oshimili South', sourceName: 'Oshimili South', populationTier: 'small-city', description: 'The southern local government holds Ogbe-Ogonogo Market, the stadium, the National Museum and the Federal Medical Centre.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'federal-secretariat-complex-asaba', name: 'Federal Secretariat Complex', kind: 'government', lon: 6.6889358, lat: 6.2193373, localUnitId: 'oshimili-north',
      description: 'A mapped government office named Federal Secretariat Complex in Asaba.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 7956232289 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'government-hospital-ibusa', name: 'Government Hospital Ibusa', kind: 'hospital', lon: 6.6155133, lat: 6.1719514, localUnitId: 'oshimili-north',
      description: 'A mapped hospital building named Government Hospital Ibusa in Oshimili North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1058095865 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'federal-medical-centre-asaba', name: 'Federal Medical Centre Asaba', kind: 'hospital', lon: 6.7122752, lat: 6.2131176, localUnitId: 'oshimili-south',
      description: 'A Wikidata medical centre record named Federal Medical Centre Asaba.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q105622877' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'federal-college-of-education-technical-asaba', name: 'Federal College of Education (Technical), Asaba', kind: 'college', lon: 6.700168, lat: 6.185164, localUnitId: 'oshimili-south',
      description: 'A Wikidata college-of-education record for the Federal College of Education (Technical), Asaba, Delta State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q129338358' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'national-museum-asaba', name: 'National Museum Asaba', kind: 'museum', lon: 6.6959, lat: 6.2059, localUnitId: 'oshimili-south',
      description: 'A Wikidata museum record for the National Museum Asaba, held in the 1886 Royal Niger Company timber house named after Mungo Park.', sourceIds: ['wikidata-selected', 'discover-delta-asaba'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q111864557' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'holy-family-catholic-church-asaba', name: 'Holly Family Catholic Church', kind: 'church', lon: 6.6519251, lat: 6.2200961, localUnitId: 'oshimili-north',
      description: 'A mapped Catholic place of worship tagged Holly Family Catholic Church in Oshimili North.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 4873806367 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'ogbeogonogo-modern-market', name: 'Ogbeogonogo Modern Market', kind: 'market', lon: 6.734172, lat: 6.201631, localUnitId: 'oshimili-south',
      description: 'A Wikidata market record for Ogbeogonogo Modern Market; Discover Delta describes Ogbe-Ogonogo as the big modern market selling yams, spices, smoked fish and fabric.', sourceIds: ['wikidata-selected', 'discover-delta-asaba'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136654114' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['asaba-market-staples'],
    },
    {
      id: 'stephen-keshi-stadium', name: 'Stephen Keshi Stadium', kind: 'stadium', lon: 6.7222076, lat: 6.2067081, localUnitId: 'oshimili-south',
      description: 'A mapped sports centre named Stephen Keshi Stadium, which Discover Delta calls the main stadium of Asaba.', sourceIds: ['osm-selected', 'discover-delta-asaba'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 661995453 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'eco-bank-asaba', name: 'Eco bank', kind: 'savings', lon: 6.7407002, lat: 6.1936907, localUnitId: 'oshimili-south',
      description: 'A mapped bank tagged Eco bank in Asaba.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 12569218597 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'pokaribs-native-kitchen', name: 'Pokaribs Native Kitchen & Lounge', kind: 'eatery', lon: 6.7031286, lat: 6.1990477, localUnitId: 'oshimili-south',
      description: 'A Wikidata restaurant record for Pokaribs Native Kitchen & Lounge in Asaba; the featured dish is a state-level Delta cuisine item, not a menu record.', sourceIds: ['wikidata-selected', 'nico-delta-cuisine'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136812472' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['stall'] }, featuredIdentityId: 'delta-banga-soup',
    },
    {
      id: 'asaba-international-airport', name: 'Asaba International Airport', kind: 'airport', lon: 6.6611796, lat: 6.2092418, localUnitId: 'oshimili-north',
      description: 'A mapped terminal building tagged Asaba International Airport in Oshimili North.', sourceIds: ['osm-selected', 'discover-delta-asaba'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 495687558 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'], landmark: 'tower' },
    },
    {
      id: 'first-empire-bar', name: '1st Empire', kind: 'nightlife', lon: 6.7296808, lat: 6.1859907, localUnitId: 'oshimili-south',
      description: 'A mapped bar tagged 1st Empire in Asaba.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 13027746317 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'asaba-market-staples', name: 'Yams, spices and smoked fish', description: 'Discover Delta says Ogbe-Ogonogo Market sells yams, spices, smoked fish and fabric.', sourceIds: ['discover-delta-asaba'] },
      { id: 'delta-banga-soup', name: 'Banga Soup', description: 'The NICO Delta State cuisine list names Banga Soup first among Delta dishes.', sourceIds: ['nico-delta-cuisine'], note: 'State-level cuisine list, not specific to Asaba.' },
    ],
    crafts: [
      { id: 'asaba-textiles-fabric', name: 'Textiles and fabric', description: 'Wikipedia says the Asaba Textile Mills were established in the city, and Discover Delta lists fabric among Ogbe-Ogonogo Market goods.', sourceIds: ['wikipedia-asaba', 'discover-delta-asaba'], note: 'A mill and market-trade record rather than a documented hand craft.' },
    ],
    industries: [
      { id: 'asaba-manufacturing', name: 'Textile, pharmaceutical and steel manufacturing', description: 'Wikipedia says the city hosts the Asaba Textile Mills, pharmaceutical companies and a steel mill, alongside a leading civil service.', sourceIds: ['wikipedia-asaba'] },
      { id: 'asaba-film-village', name: 'Film Village', description: 'Wikipedia says a Film Village opened in Asaba in 2023 to support the Nollywood entertainment industry.', sourceIds: ['wikipedia-asaba'] },
    ],
  },
  transport: {
    airports: [{ placeId: 'asaba-international-airport', status: 'operational', sourceIds: ['discover-delta-asaba'] }],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry', rainyMonths: [3, 4, 5, 6, 7, 8, 9, 10], dryMonths: [12, 1, 2],
    description: 'A tropical savanna climate (Aw) with a wet season from March into late October and a dry season from November into late February.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-asaba'],
  },
  homePalette: { back: '#6f9aa6', left: '#3f6572', floor: ['#c8b78e', '#6a8a5c'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/asaba-surface.geojson', bytes: 344448, sha256: '0b9ae3a7b3d0905c16f80eb3ec7b04ed9b7c11d256fceeb82976fa598d8554d0' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Asaba', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/asaba/reviewed/osm-selected.json', bytes: 2404, sha256: '78afafc992bf1381fc717f00fd3491b55df2ea08976e77849da7b18aed38c2c7' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Asaba', url: 'https://www.wikidata.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/asaba/reviewed/wikidata-selected.json', bytes: 10951, sha256: 'fdb3df2bc4e1280b3d7c7232b7c2181d657ef4210d1a4c52c1cefefaafb41168' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/asaba/reviewed/geography.json', bytes: 414, sha256: '13fcd231130ffde6bba0405a1dca55d1775fd1d23e65427e7502117d16a2e832' } },
    { id: 'wikipedia-asaba', title: 'Asaba, Delta (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Asaba,_Delta', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/asaba/reviewed/wikipedia-asaba.json', bytes: 885, sha256: '176ccbc3fa4fff8fc37854e74f901b416dffecccd9b955141b7654c68a04f0e0' } },
    { id: 'discover-delta-asaba', title: 'Things to do in Asaba, Delta State (Discover Delta)', url: 'https://discoverdeltang.com/visit/asaba', checkedOn: '2026-10-06', supports: ['identity', 'transport'], cache: { path: 'scripts/city/research/asaba/reviewed/discover-delta-asaba.json', bytes: 587, sha256: '82e84f236cc7ae67e4ed31761922a15627f40b76153346b84c4dbd9020cc5679' } },
    { id: 'nico-delta-cuisine', title: 'Cuisines in Nigeria (NICO)', url: 'https://nico.gov.ng/cuisines-in-nigeria/', checkedOn: '2026-10-06', supports: ['identity'], cache: { path: 'scripts/city/research/asaba/reviewed/nico-delta-cuisine.json', bytes: 375, sha256: '645cc7925a27ba04266d2b5cc471c6cc247d1e6de48bef896dde91a29f22bf33' } },
  ],
  unmapped: [
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06; Nelson Mandela Gardens is tagged theme_park, not garden.' },
    { kind: 'mosque', note: 'No named mosque with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06 outside a barracks compound.' },
    { kind: 'park', note: 'No named park with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'road-hub', note: 'No named bus station, motor park or terminal with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No salon-tagged OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
  ],
})
