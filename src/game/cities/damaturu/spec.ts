import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'damaturu',
  name: 'Damaturu',
  state: { id: 'yobe', name: 'Yobe', sourceName: 'Yobe', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 11.966666666667,
    lat: 11.75,
    teaser: 'The Yobe capital, with a national museum, a central mosque and busy modern markets.',
    preview: ['Visit the National Museum and Damaturu Central Mosque.', 'Shop at Damaturu Modern Market and Bayan Tasha market.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q1023722' },
  },
  population: { tier: 'small-city', sourceIds: ['damaturu-wiki'], note: 'The cited article reports 88,014 residents at the 2006 census and an estimated 137,900 for 2022.' },
  localUnits: [
    { id: 'damaturu', name: 'Damaturu', sourceName: 'Damaturu', populationTier: 'small-city', description: 'The selected Damaturu local government holds the state offices, museum, markets and every mapped venue.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'damaturu-central-mosque', name: 'Damaturu Central Mosque', kind: 'mosque', lon: 11.973888888888888, lat: 11.7425, localUnitId: 'damaturu',
      description: 'Wikidata records Damaturu Central Mosque with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136716494' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'yobe-islamic-centre', name: 'Yobe Islamic Centre', kind: 'mosque', lon: 11.9737687, lat: 11.7424816, localUnitId: 'damaturu',
      description: 'A mapped mosque named Yobe Islamic Centre.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 14040423752 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'st-marys-catholic-church-damaturu', name: "St. Mary's Catholic Church", kind: 'church', lon: 11.96403762267574, lat: 11.730982100827283, localUnitId: 'damaturu',
      description: "Wikidata records St. Mary's Catholic Church in Damaturu with a published coordinate.", sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125399241' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'federal-polytechnic-damaturu', name: 'Federal Polytechnic Damaturu', kind: 'polytechnic', lon: 11.983944895417537, lat: 11.74755995018884, localUnitId: 'damaturu',
      description: 'Wikidata records Federal Polytechnic Damaturu with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q100709256' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'yobe-state-university', name: 'Yobe State University', kind: 'university', lon: 11.9444078, lat: 11.6834448, localUnitId: 'damaturu',
      description: 'A mapped university named Yobe State University.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 845940671 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'lamp'] },
    },
    {
      id: 'national-museum-damaturu', name: 'National Museum, Damaturu', kind: 'museum', lon: 11.96256711295252, lat: 11.743669060519835, localUnitId: 'damaturu',
      description: 'Wikidata records the National Museum, Damaturu as a national museum in Yobe State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q112063539' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'damaturu-modern-market', name: 'DAMATURU MODERN MARKET', kind: 'market', lon: 11.9521939, lat: 11.7405122, localUnitId: 'damaturu',
      description: 'Wikidata records Damaturu Modern Market; Wikipedia lists gum arabic, groundnuts, beans and cotton among Yobe produce.', sourceIds: ['wikidata-selected', 'yobe-wiki'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136540450' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['yobe-agriculture'],
    },
    {
      id: 'bayan-tasha-market', name: 'Bayan Tasha market', kind: 'market', lon: 11.961976265912483, lat: 11.745123285279607, localUnitId: 'damaturu',
      description: 'Wikidata records Bayan Tasha market in Yobe State; Wikipedia lists groundnuts, beans and cotton among Yobe produce.', sourceIds: ['wikidata-selected', 'yobe-wiki'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136542183' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['yobe-agriculture'],
    },
    {
      id: 'yobe-line-motor-park', name: 'Yobe Line Motor Park', kind: 'road-hub', lon: 11.956642858952451, lat: 11.740906265582705, localUnitId: 'damaturu',
      description: 'Wikidata records Yobe Line Motor Park as a motor park in Yobe State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q134599740' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'august-27-stadium', name: 'August 27 stadium', kind: 'stadium', lon: 11.9916, lat: 11.745, localUnitId: 'damaturu',
      description: 'Wikidata records August 27 stadium in Damaturu with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q140588636' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'], landmark: 'tower' },
    },
    {
      id: 'yobe-state-house-of-assembly', name: 'Yobe State House of Assembly', kind: 'government', lon: 11.994374021624072, lat: 11.744787781296406, localUnitId: 'damaturu',
      description: 'Wikidata records the Yobe State House of Assembly with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q59518873' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'], landmark: 'gate' },
    },
    {
      id: 'general-sani-abacha-specialist-hospital', name: 'General Sani Abacha State Specialist Hospital', kind: 'hospital', lon: 11.9565398, lat: 11.7296659, localUnitId: 'damaturu',
      description: 'Wikidata records General Sani Abacha State Specialist Hospital in Yobe State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q109735548' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'state-teaching-hospital-damaturu', name: 'State Teaching Hospital', kind: 'hospital', lon: 11.9216627, lat: 11.7366991, localUnitId: 'damaturu',
      description: 'A mapped hospital named State Teaching Hospital.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 837592299 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'dan-wake', name: 'Dan wake', description: 'Dan wake is a Hausa dish of bean dumplings, eaten with palm or peanut oil.', sourceIds: ['hausa-cuisine-wiki'] },
    ],
    crafts: [
      { id: 'karai-karai-crafts', name: 'Karai-Karai crafts', description: 'Wikipedia describes the Karai-Karai people of the region as skilled craftsmen in wood-carving, weaving, metal work and painting.', sourceIds: ['karai-karai-wiki'] },
    ],
    industries: [
      { id: 'yobe-agriculture', name: 'Yobe farm produce', description: 'Wikipedia calls Yobe an agricultural state whose produce includes gum arabic, groundnuts, beans and cotton.', sourceIds: ['yobe-wiki'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'sahel', rainyMonths: [5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3, 4],
    description: 'Damaturu has hot, cloudy rainy seasons and windy, partly cloudy dry seasons, with its clearer season running from early November to early March.',
    clearLabel: 'Clearer-season sky', sourceIds: ['damaturu-wiki'],
  },
  homePalette: { back: '#e3cda0', left: '#a98a55', floor: ['#d4bb86', '#8a9560'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/damaturu-surface.geojson', bytes: 171583, sha256: '6f803382b4b33dcfd300efb654643267755bc30ccfbcfd15d0b88eae423fa912' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Damaturu', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/damaturu/reviewed/osm-selected.json', bytes: 1136, sha256: 'f69161aaf92cd8066fa2fa53eb54295324c39b1441e9d3ad86f95840d331f93d' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Damaturu', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/damaturu/reviewed/wikidata-selected.json', bytes: 10439, sha256: '76fc183866d564d348da1a97aa01d68e348114127e6e97fede915e0c16643cb0' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/damaturu/reviewed/geography.json', bytes: 346, sha256: 'e3f1bb60ec927a48c92d94fcd7ee2986a1ba79e9134f8a44507faa8883b2e25d' } },
    { id: 'damaturu-wiki', title: 'Wikipedia: Damaturu', url: 'https://en.wikipedia.org/wiki/Damaturu', checkedOn: '2026-10-06', supports: ['population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/damaturu/reviewed/damaturu-wiki.json', bytes: 393, sha256: 'c07b7650887918990d6d2641f12901b83c873e247bb0d52e618f6db975550490' } },
    { id: 'yobe-wiki', title: 'Wikipedia: Yobe State', url: 'https://en.wikipedia.org/wiki/Yobe_State', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/damaturu/reviewed/yobe-wiki.json', bytes: 238, sha256: 'eb1ca1b5cb95efb974dfc017d4c96e9ff87acfa29ed2be009b8b645312d219a7' } },
    { id: 'hausa-cuisine-wiki', title: 'Wikipedia: Hausa cuisine', url: 'https://en.wikipedia.org/wiki/Hausa_cuisine', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/damaturu/reviewed/hausa-cuisine-wiki.json', bytes: 225, sha256: 'ee8b9ef3a73636b5ae3ff3ac140f37d06907f8c2daac919f25b52cfcdf1d98db' } },
    { id: 'karai-karai-wiki', title: 'Wikipedia: Karai-Karai people', url: 'https://en.wikipedia.org/wiki/Karai-Karai_people', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/damaturu/reviewed/karai-karai-wiki.json', bytes: 309, sha256: 'c126142c228caa4b98173e98ec6d897ec45b3b6f5ddd18ab7cd61ecae3db9ead' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'No named eatery with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'park', note: 'No named public park with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No named salon or barber shop with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'savings', note: 'No named bank branch with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
  ],
})
