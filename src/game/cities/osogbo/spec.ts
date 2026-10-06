import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'osogbo',
  name: 'Osogbo',
  state: { id: 'osun', name: 'Osun', sourceName: 'Osun', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 4.5666666666667,
    lat: 7.7666666666667,
    teaser: 'Adire dyeing, the Osun sacred grove and the market trade of Osun State.',
    preview: ['Visit the Osun-Osogbo Sacred Grove.', 'Cross the city through Osogbo and Olorunda.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q868203' },
  },
  population: { tier: 'small-city', sourceIds: ['wikipedia-osogbo'], note: 'Wikipedia gives about 200,000 people for the city; the article does not date the figure.' },
  localUnits: [
    { id: 'osogbo', name: 'Osogbo', sourceName: 'Osogbo', populationTier: 'small-city', description: 'The selected central local government contains the churches, markets, stadium, hospitals, universities and the sacred grove.', sourceIds: ['geography'] },
    { id: 'olorunda', name: 'Olorunda', sourceName: 'Olorunda', populationTier: 'small-city', description: 'The selected northern local government contains the mapped ABEGI ANU bar.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'union-baptist-church', name: 'Union Baptist Church', kind: 'church', lon: 4.5450695, lat: 7.7733145, localUnitId: 'osogbo',
      description: 'A mapped Baptist place of worship named Union Baptist Church in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 3391589632 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'calvary-baptist-church', name: 'Calvary Baptist Church', kind: 'church', lon: 4.5449961, lat: 7.7692683, localUnitId: 'osogbo',
      description: 'A mapped Baptist place of worship named Calvary Baptist Church in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 3438958252 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'nelson-mandela-freedom-park', name: 'Nelson Mandela Freedom Park', kind: 'park', lon: 4.546762, lat: 7.779317, localUnitId: 'osogbo',
      description: 'A mapped public park named Nelson Mandela Freedom Park in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 332058049 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'osun-house-of-assembly', name: 'Osun State House of Assembly', kind: 'government', lon: 4.5204537, lat: 7.7399552, localUnitId: 'osogbo',
      description: 'A mapped government office named Osun State House of Assembly on Gbongan-Osogbo Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 378192881 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'lautech-teaching-hospital', name: 'LAUTECH Teaching Hospital', kind: 'hospital', lon: 4.5514558, lat: 7.7785564, localUnitId: 'osogbo',
      description: 'A mapped hospital named LAUTECH Teaching Hospital in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 802557791 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'our-lady-of-fatima-hospital', name: 'Our Lady of Fatima Hospital', kind: 'hospital', lon: 4.5488489, lat: 7.7693131, localUnitId: 'osogbo',
      description: 'A mapped hospital named Our Lady of Fatima Hospital in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 802567197 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'ayegbaju-market', name: 'Ayegbaju International Modern Market', kind: 'market', lon: 4.5384396, lat: 7.7654034, localUnitId: 'osogbo',
      description: 'A mapped marketplace named Ayegbaju International Modern Market on Gbongan-Osogbo Road. Its specialty link is the regional farm-produce trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-osogbo'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 378297555 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['osogbo-yam'],
    },
    {
      id: 'igboona-market', name: 'Igboona Market', kind: 'market', lon: 4.5577879, lat: 7.7807451, localUnitId: 'osogbo',
      description: 'A mapped marketplace named Igboona Market on Obafemi Awolowo Way. Its specialty link is the city-wide adire trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-osogbo'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 3822301364 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['osogbo-adire'],
    },
    {
      id: 'new-orisunbare-market', name: 'New Orisunbare Market', kind: 'market', lon: 4.5483043, lat: 7.7785499, localUnitId: 'osogbo',
      description: 'A mapped marketplace named New Orisunbare Market in Osogbo. Its specialty link is the regional farm-produce trade, not a market-specific source.', sourceIds: ['osm-selected', 'wikipedia-osogbo'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 3391605680 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['osogbo-yam'],
    },
    {
      id: 'gtbank-osogbo', name: 'GTBank', kind: 'savings', lon: 4.534034, lat: 7.7635172, localUnitId: 'osogbo',
      description: 'A mapped bank tagged GTB on Gbongan-Osogbo Road.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 327544680 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'osogbo-township-stadium', name: 'Osogbo Township Stadium', kind: 'stadium', lon: 4.5721467, lat: 7.7937375, localUnitId: 'osogbo',
      description: 'A mapped stadium named Osogbo Township Stadium; Wikipedia notes a football stadium with a capacity of 10,000.', sourceIds: ['osm-selected', 'wikipedia-osogbo'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 934208949 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'fountain-university', name: 'Fountain University', kind: 'university', lon: 4.5456978, lat: 7.7437299, localUnitId: 'osogbo',
      description: 'A mapped university named Fountain University in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 378033206 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'noun-osogbo', name: 'National Open University of Nigeria', kind: 'university', lon: 4.5682033, lat: 7.7514995, localUnitId: 'osogbo',
      description: 'A mapped university named National Open University of Nigeria in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 328327566 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'osun-osogbo-sacred-grove', name: 'Osun-Osogbo Sacred Grove', kind: 'heritage', lon: 4.5506394, lat: 7.7551115, localUnitId: 'osogbo',
      description: 'The mapped Osun-Osogbo Sacred Grove; Wikipedia says the annual Osun-Osogbo festival centres on it and it is a UNESCO World Heritage Site.', sourceIds: ['osm-selected', 'wikipedia-osogbo'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 4245488118 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree'] },
    },
    {
      id: 'susanne-wenger-house', name: 'Susanne Wenger House', kind: 'museum', lon: 4.5607842, lat: 7.7666598, localUnitId: 'osogbo',
      description: 'A mapped museum building named Susanne Wenger House in Osogbo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1067599915 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'abegi-anu-bar', name: 'ABEGI ANU', kind: 'nightlife', lon: 4.5408071, lat: 7.7981331, localUnitId: 'olorunda',
      description: 'A mapped bar named ABEGI ANU in Olorunda.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 5328144613 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'osogbo-yam', name: 'Yam', description: 'Wikipedia lists yams, cassava, grain and tobacco among the farm produce of the region around Osogbo.', sourceIds: ['wikipedia-osogbo'] },
    ],
    crafts: [
      { id: 'osogbo-adire', name: 'Adire tie-and-dye', description: 'Wikipedia calls Osogbo "Ilu Aro", a major dyeing centre whose traditional adire industry includes raffia, stitch, starch and wax-batik resist types.', localProductId: 'adire', sourceIds: ['wikipedia-osogbo'] },
    ],
    industries: [
      { id: 'osogbo-farm-trade', name: 'Farm-produce trade and light industry', description: 'Wikipedia calls Osogbo the trade centre of a farming region and notes small-scale textile, foam and pencil industries.', sourceIds: ['wikipedia-osogbo'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry', rainyMonths: [3, 4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2],
    description: 'A tropical climate with about 1,361 mm of yearly rain; the Wikivoyage chart shows heavy rain from March to October and little from November to February.',
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-osogbo', 'wikivoyage-osogbo'],
  },
  homePalette: { back: '#a9bcc9', left: '#566b84', floor: ['#c5b184', '#5c7a66'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/osogbo-surface.geojson', bytes: 108676, sha256: 'dd56912234badda2f857589c0666fd9ed6f9a4b088469bc5486a451514a27509' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Osogbo', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/osogbo/reviewed/osm-selected.json', bytes: 4441, sha256: '7d9f6ecc68f8b2b8d28f2c0f1d7fa008e59664cb9a3d678e93dd5353ac069491' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Osogbo', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/osogbo/reviewed/wikidata-selected.json', bytes: 2387, sha256: '021296df52d286236d0d8087a5a183e0e1a98503301690458e4eb63756634c2d' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/osogbo/reviewed/geography.json', bytes: 384, sha256: '3003afef673a4cf6aaeaaff15565e35ac59cd77efab79b192e94f5ea02a49e79' } },
    { id: 'wikipedia-osogbo', title: 'Osogbo (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Osogbo', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/osogbo/reviewed/wikipedia-osogbo.json', bytes: 908, sha256: '9ee96336d7c12179dc9920cce3cc001c5e73d927fd1b21e3abe20a9112e6f0a7' } },
    { id: 'wikivoyage-osogbo', title: 'Osogbo (Wikivoyage)', url: 'https://en.wikivoyage.org/wiki/Osogbo', checkedOn: '2026-10-06', supports: ['climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/osogbo/reviewed/wikivoyage-osogbo.json', bytes: 273, sha256: '4e7b338da46b2cd20208ae7d2bfe1899a1a6dbf775fac76729a8554da536a368' } },
  ],
  unmapped: [
    { kind: 'mosque', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'eatery', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'garden', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'salon', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'road-hub', note: 'not found in exact sources on 2026-10-06' },
    { kind: 'polling', note: 'not found in exact sources on 2026-10-06' },
  ],
})
