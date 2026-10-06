import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'jalingo',
  name: 'Jalingo',
  state: { id: 'taraba', name: 'Taraba', sourceName: 'Taraba', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 11.366666666667,
    lat: 8.9,
    teaser: 'The Taraba capital and seat of the Muri Emirate, with Jolly Nyame Stadium, busy markets and Rafin Sanyi Rock.',
    preview: ['Visit Rafin Sanyi Rock and the Central Mosque.', 'Shop at Jalingo centre market and Bando Market.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q1023720' },
  },
  population: { tier: 'city', sourceIds: ['jalingo-wiki'], note: 'The cited article estimates about 418,000 residents in 2018 and about 581,000 in November 2022.' },
  localUnits: [
    { id: 'jalingo', name: 'Jalingo', sourceName: 'Jalingo', populationTier: 'city', description: 'The selected Jalingo local government holds the stadium, hospitals, mosques, markets and every mapped venue.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'jolly-nyame-stadium', name: 'Jolly Nyame Stadium', kind: 'stadium', lon: 11.3544891, lat: 8.9511247, localUnitId: 'jalingo',
      description: 'A mapped stadium named Jolly Nyame Stadium.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1049258846 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'], landmark: 'tower' },
    },
    {
      id: 'specialist-hospital-jalingo', name: 'Specialist Hospital Jalingo', kind: 'hospital', lon: 11.3919524, lat: 8.9077485, localUnitId: 'jalingo',
      description: 'A mapped hospital named Specialist Hospital Jalingo.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1225431290 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'federal-medical-centre-jalingo', name: 'FEDERAL MEDICAL CENTRE JALINGO', kind: 'hospital', lon: 11.3681684, lat: 8.9000787, localUnitId: 'jalingo',
      description: 'A mapped hospital named FEDERAL MEDICAL CENTRE JALINGO.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1318268520 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'our-lady-queen-of-peace-cathedral', name: 'Our Lady Queen Of Peace Catholic Cathedral', kind: 'church', lon: 11.3713365, lat: 8.9481007, localUnitId: 'jalingo',
      description: 'A mapped Catholic cathedral named Our Lady Queen Of Peace Catholic Cathedral.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1226922973 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'st-peters-catholic-church-jalingo', name: 'St. Peter`s Catholic Church', kind: 'church', lon: 11.3264068, lat: 8.9262812, localUnitId: 'jalingo',
      description: 'A mapped Catholic church named St. Peter`s Catholic Church.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1304154373 }, accuracy: 'feature-centroid',
      scene: { roof: 'gable', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'taraba-state-civil-service', name: 'Taraba State Civil Service', kind: 'government', lon: 11.3399506, lat: 8.9333837, localUnitId: 'jalingo',
      description: 'A mapped government office named Taraba State Civil Service.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 12068918192 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'], landmark: 'gate' },
    },
    {
      id: 'government-house-mosque-jalingo', name: 'Government House Mosque Jalingo', kind: 'mosque', lon: 11.374587, lat: 8.887853, localUnitId: 'jalingo',
      description: 'Wikidata records Government House Mosque Jalingo with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125456344' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'central-mosque-sabo-gari', name: 'Central Mosque Sabo Gari Jalingo', kind: 'mosque', lon: 11.377789, lat: 8.879845, localUnitId: 'jalingo',
      description: 'Wikidata records Central Mosque Sabo Gari Jalingo with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125456307' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'nana-aishat-central-mosque', name: 'Nana Aishat Central Mosque Jalingo', kind: 'mosque', lon: 11.392528, lat: 8.885288, localUnitId: 'jalingo',
      description: 'Wikidata records Nana Aishat Central Mosque Jalingo with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q125456320' }, accuracy: 'published-point',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'], landmark: 'tower' },
    },
    {
      id: 'jalingo-centre-market', name: 'Jalingo centre market', kind: 'market', lon: 11.3598894, lat: 8.8942138, localUnitId: 'jalingo',
      description: 'Wikidata records Jalingo centre market; Wikipedia lists coffee, tea, groundnuts and cotton among Taraba cash crops.', sourceIds: ['wikidata-selected', 'taraba-wiki'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136535070' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['taraba-cash-crops'],
    },
    {
      id: 'bando-market', name: 'Bando Market', kind: 'market', lon: 11.3816804, lat: 8.8760734, localUnitId: 'jalingo',
      description: 'Wikidata records Bando Market in Jalingo; Wikipedia lists groundnuts and cotton among Taraba cash crops.', sourceIds: ['wikidata-selected', 'taraba-wiki'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q136533905' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'roadside', props: ['stall', 'lamp'] }, specialtyIds: ['taraba-cash-crops'],
    },
    {
      id: 'college-of-education-jalingo', name: 'College of Education, Jalingo', kind: 'college', lon: 11.365019583744896, lat: 8.89916448150062, localUnitId: 'jalingo',
      description: 'Wikidata records the College of Education, Jalingo with a published coordinate.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q107477998' }, accuracy: 'published-point',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'rafin-sanyi-rock', name: 'Rafin Sanyi Rock', kind: 'heritage', lon: 11.3845808, lat: 8.8986972, localUnitId: 'jalingo',
      description: 'Wikidata records Rafin Sanyi Rock as a rock landmark in Taraba State.', sourceIds: ['wikidata-selected'],
      coordinateSourceId: 'wikidata-selected', coordinateRef: { provider: 'wikidata', entity: 'Q134622971' }, accuracy: 'published-point',
      scene: { roof: 'gable', sign: 'facade', props: ['tree', 'bench'] },
    },
  ],
  identity: {
    foods: [
      { id: 'tuwon-shinkafa', name: 'Tuwon shinkafa', description: 'Tuwon shinkafa is a Hausa swallow made from rice; Taraba also grows rice as a food crop.', sourceIds: ['hausa-cuisine-wiki', 'taraba-wiki'] },
    ],
    crafts: [
      { id: 'taraba-crafts', name: 'Taraba weaving, pottery and carving', description: 'Wikipedia says pottery, cloth-weaving, dyeing, mat-making, carving, embroidery and blacksmithing are practised in parts of Taraba State.', sourceIds: ['taraba-wiki'] },
    ],
    industries: [
      { id: 'taraba-cash-crops', name: 'Taraba farming', description: 'Wikipedia says agriculture is the major occupation in Taraba, with cash crops including coffee, tea, groundnuts and cotton.', sourceIds: ['taraba-wiki'] },
    ],
  },
  transport: {
    airports: [],
    rail: [],
    ports: [],
  },
  climate: {
    profile: 'northern-savanna', rainyMonths: [4, 5, 6, 7, 8, 9, 10], dryMonths: [11, 12, 1, 2, 3],
    description: 'Jalingo has a tropical savanna climate with an oppressive, cloudy wet season and a partly cloudy dry season, and its clearer season runs from late October to early March.',
    clearLabel: 'Clearer-season sky', sourceIds: ['jalingo-wiki'],
  },
  homePalette: { back: '#b5c3a6', left: '#5f7a52', floor: ['#c2b080', '#4f7a4a'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/jalingo-surface.geojson', bytes: 75753, sha256: '09fa3477dddb42d1ba3d1073010eb986b6d585e7bac51583442fd9615fe67634' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Jalingo', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/jalingo/reviewed/osm-selected.json', bytes: 2124, sha256: '98e3367fdfc71341cc43feafeab05f43f1c4f42416d6a92de5bb311e4cebf2bb' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Jalingo', url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/jalingo/reviewed/wikidata-selected.json', bytes: 6628, sha256: '86eb8c6b3a36ef8ff1f20765c6f935fb78086e2046a4fc835928934e0be160b3' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/jalingo/reviewed/geography.json', bytes: 348, sha256: '0804df6289ed80855ab0c8edc41426c73f552117950173d9cbf415967a712e49' } },
    { id: 'jalingo-wiki', title: 'Wikipedia: Jalingo', url: 'https://en.wikipedia.org/wiki/Jalingo', checkedOn: '2026-10-06', supports: ['population', 'climate', 'identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/jalingo/reviewed/jalingo-wiki.json', bytes: 497, sha256: '4ea59163e41178c49c24d3bfd810a3416d6953e0647db621e8b2c04e0425b775' } },
    { id: 'taraba-wiki', title: 'Wikipedia: Taraba State', url: 'https://en.wikipedia.org/wiki/Taraba_State', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/jalingo/reviewed/taraba-wiki.json', bytes: 431, sha256: 'd9e3bf8b5f9dc7b49b4b0aba61fa4d3462057c88e9b374d2d2f27e4693ae6ed3' } },
    { id: 'hausa-cuisine-wiki', title: 'Wikipedia: Hausa cuisine', url: 'https://en.wikipedia.org/wiki/Hausa_cuisine', checkedOn: '2026-10-06', supports: ['identity'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/jalingo/reviewed/hausa-cuisine-wiki.json', bytes: 201, sha256: '2ee9a4af022b4192d92e69607763c9946024ae66b9478b8ec566aca22d78a365' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'No named eatery with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'park', note: 'No named public park with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'road-hub', note: 'No named motor park or bus station with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No named salon or barber shop with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'savings', note: 'No named bank branch with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
  ],
})
