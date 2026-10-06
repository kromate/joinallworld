import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'minna',
  name: 'Minna',
  state: { id: 'niger', name: 'Niger', sourceName: 'Niger', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 6.5569444444444,
    lat: 9.6138888888889,
    teaser: 'Leather work, farm trade and the Federal University of Technology on the Niger State plateau.',
    preview: ['Visit Kure Market.', 'Cross the city through Chanchaga and Bosso.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q994105' },
  },
  population: { tier: 'small-city', sourceIds: ['wikivoyage-minna', 'wikipedia-minna'], note: 'Wikivoyage gives an estimated 345,000 residents for 2016 and Wikipedia lists an undated estimate of 322,163; the figures are not a single dated census.' },
  localUnits: [
    { id: 'chanchaga', name: 'Chanchaga', sourceName: 'Chanchaga', populationTier: 'small-city', description: 'The selected central local government contains the cathedral, Kure Market, the state assembly and the hospital.', sourceIds: ['geography'] },
    { id: 'bosso', name: 'Bosso', sourceName: 'Bosso', populationTier: 'small-city', description: "The selected local government contains the Federal University of Technology main campus, the bus park and King's Corner.", sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'st-michaels-cathedral', name: "St. Michael's Catholic Cathedral", kind: 'church', lon: 6.5440077, lat: 9.6254332, localUnitId: 'chanchaga',
      description: "A mapped Roman Catholic place of worship tagged as St. Michael's Catholic Cathedral in Chanchaga.", sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 11028868973 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'secretariat-juma-at-mosque', name: "Niger State Secretariat Juma'at Mosque", kind: 'mosque', lon: 6.564997, lat: 9.5832787, localUnitId: 'chanchaga',
      description: "A mapped Muslim place of worship named Niger State Secretariat Juma'at Mosque.", sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 672190030 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'kings-corner', name: "King's Corner", kind: 'eatery', lon: 6.442859, lat: 9.5310111, localUnitId: 'bosso',
      description: 'A mapped restaurant whose cuisine tag lists moi-moi, rice, indomie, bread, eggs and tea.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 574075971 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] }, featuredIdentityId: 'moi-moi',
    },
    {
      id: 'yemisi-suswam-garden', name: 'Yemisi Suswam Garden', kind: 'garden', lon: 6.449772, lat: 9.5323071, localUnitId: 'bosso',
      description: 'A mapped garden named Yemisi Suswam Garden in Bosso.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 759702386 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'veez-garden', name: 'Veez Garden', kind: 'park', lon: 6.520021, lat: 9.6439093, localUnitId: 'chanchaga',
      description: 'A mapped park named Veez Garden in Chanchaga.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1137398484 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'niger-state-house-of-assembly', name: 'Niger State House Assembly', kind: 'government', lon: 6.5682724, lat: 9.5843725, localUnitId: 'chanchaga',
      description: 'A mapped government office named Niger State House Assembly in Chanchaga.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 672194345 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'general-hospital-minna', name: 'General Hospital Minna', kind: 'hospital', lon: 6.5446701, lat: 9.612486, localUnitId: 'chanchaga',
      description: 'A mapped hospital named General Hospital Minna.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8430037633 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'kure-market', name: 'Kure Market', kind: 'market', lon: 6.5308373, lat: 9.6174065, localUnitId: 'chanchaga',
      description: "A mapped marketplace named Kure Market; Wikivoyage describes the Abdulkadir Kure market as Minna's largest, selling household, food and clothing items. The name match is an inference.", sourceIds: ['osm-selected', 'wikivoyage-minna', 'wikipedia-minna'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 10168829108 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['minna-farm-produce'],
    },
    {
      id: 'gtbank-minna', name: 'GTBank', kind: 'savings', lon: 6.5579187, lat: 9.6033074, localUnitId: 'chanchaga',
      description: 'A mapped bank tagged GTBank on the Zungeru-Izom federal road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 9958911517 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'minna-stadium', name: 'Minna stadium', kind: 'stadium', lon: 6.5492865, lat: 9.6217737, localUnitId: 'chanchaga',
      description: 'A mapped sports pitch named Minna stadium in Chanchaga.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 669592216 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'minna-bus-park', name: 'Bus Park', kind: 'road-hub', lon: 6.4554683, lat: 9.5365589, localUnitId: 'bosso',
      description: 'A mapped bus station and public-transport station named Bus Park in Bosso.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 668542274 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['bench', 'lamp'] },
    },
    {
      id: 'fut-minna-main-campus', name: 'Federal University of Technology, Minna', kind: 'university', lon: 6.4469008, lat: 9.5310126, localUnitId: 'bosso',
      description: 'A mapped university whose English name tag is Main Campus (Gidan Kwano), on Minna-Bida Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 416896586 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'fut-minna-bosso-campus', name: 'Federal University of Technology Minna, Bosso Campus', kind: 'university', lon: 6.5258588, lat: 9.6538292, localUnitId: 'chanchaga',
      description: 'A mapped university named Federal University of Technology Minna, Bosso Campus.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1178609012 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'federal-library-minna', name: 'Federal Library Minna', kind: 'civic-landmark', lon: 6.5376404, lat: 9.6136513, localUnitId: 'chanchaga',
      description: 'A mapped library building named Federal library Minna in Chanchaga.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 630008904 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
  ],
  identity: {
    foods: [
      { id: 'moi-moi', name: 'Moi-moi', description: "The mapped cuisine tag for King's Corner lists moi-moi, rice, indomie, bread, eggs and tea.", sourceIds: ['osm-selected'] },
    ],
    crafts: [
      { id: 'minna-leather-metal', name: 'Leather work and metalworking', description: 'Wikipedia lists leather work and metalworking as traditional industries and crafts in Minna.', localProductId: 'leather-sandals', sourceIds: ['wikipedia-minna'] },
    ],
    industries: [
      { id: 'minna-farm-produce', name: 'Farm produce and soap manufacturing', description: 'Wikipedia lists cotton, guinea corn, maize, ginger and yam as main farm products, and names PZ Cussons for toilet soaps.', localProductId: 'soap', sourceIds: ['wikipedia-minna'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'middle-belt-wet-dry', rainyMonths: [5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3, 4],
    description: 'A Middle Belt tropical savanna climate with a harmattan-dominated dry season from November to April and a wet season from May to October.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-minna'], harmattan: { months: [11, 12, 1, 2, 3, 4], label: 'Harmattan dust' },
  },
  homePalette: { back: '#cdb48a', left: '#8a6a45', floor: ['#bfa36d', '#73835b'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/minna-surface.geojson', bytes: 374737, sha256: 'cef13aeb13cd2e3c3af56557de17dbd385ae6d9542b45832080ea8971a5946f4' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Minna', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/minna/reviewed/osm-selected.json', bytes: 4207, sha256: 'ae230fd742ff033a0f3cf435cf2e86ed358957db4a4f67da7226464281e85347' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Minna', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/minna/reviewed/wikidata-selected.json', bytes: 1136, sha256: '4b2e0c3fef119dc985979f7470f47fd6055e43a69eebaa511eb78077dafc34cd' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/minna/reviewed/geography.json', bytes: 386, sha256: 'b8b4f370cc4a3d58749660171f96aa89c2b16ca82604cac0572dcfd7973fe76e' } },
    { id: 'wikipedia-minna', title: 'Minna (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Minna', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/minna/reviewed/wikipedia-minna.json', bytes: 725, sha256: 'fe988ef958200de6c28405618a3bbf860085805159e379751909af6b3daa2553' } },
    { id: 'wikivoyage-minna', title: 'Minna (Wikivoyage)', url: 'https://en.wikivoyage.org/wiki/Minna', checkedOn: '2026-10-06', supports: ['identity', 'population'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/minna/reviewed/wikivoyage-minna.json', bytes: 326, sha256: '011a48a0a2f62c4a67d6b7cce6d00cf2a37c9fde4fee29dfdccbb867d1bed10d' } },
  ],
  unmapped: [
    { kind: 'salon', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
