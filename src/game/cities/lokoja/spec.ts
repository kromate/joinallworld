import { defineCitySpec } from '../spec.ts'

export const CITY_SPEC = defineCitySpec({
  schemaVersion: 1,
  id: 'lokoja',
  name: 'Lokoja',
  state: { id: 'kogi', name: 'Kogi', sourceName: 'Kogi', unit: 'local government', sourceIds: ['geography'] },
  country: { id: 'nigeria', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 6.7441666666667,
    lat: 7.8019444444444,
    teaser: 'The confluence town where the Niger and Benue meet, with grain markets and river trade.',
    preview: ['Visit the Old Market and the Lokoja National Museum.', 'Cross the city through the Lokoja local government.'],
    coordinateSourceId: 'wikidata-selected',
    coordinateRef: { provider: 'wikidata', entity: 'Q994085' },
  },
  population: { tier: 'city', sourceIds: ['wikipedia-lokoja'], note: 'Wikipedia estimates more than 265,000 people as at 2022; the figure is a secondary estimate, not a census.' },
  localUnits: [
    { id: 'lokoja', name: 'Lokoja', sourceName: 'Lokoja', populationTier: 'city', description: 'The selected local government contains the Old Market, the museum, the hospitals, the university and the stadium.', sourceIds: ['geography'] },
  ],
  places: [
    {
      id: 'kgirs-lokoja', name: 'KGIRS', kind: 'government', lon: 6.7443786, lat: 7.8000832, localUnitId: 'lokoja',
      description: 'A mapped government office tagged KGIRS in Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563679 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'federal-medical-centre-lokoja', name: 'Federal Medical Centre', kind: 'hospital', lon: 6.7415676, lat: 7.799937, localUnitId: 'lokoja',
      description: 'A mapped hospital named Federal Medical Centre in Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563676 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['planter', 'lamp'] },
    },
    {
      id: 'kogi-state-specialist-hospital', name: 'Kogi State Specialist Hospital, Lokoja', kind: 'hospital', lon: 6.7314804, lat: 7.7936162, localUnitId: 'lokoja',
      description: 'A mapped hospital named Kogi State Specialist Hospital, Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 617512416 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'federal-university-lokoja', name: 'Federal University Lokoja', kind: 'university', lon: 6.7319975, lat: 7.7921375, localUnitId: 'lokoja',
      description: 'A mapped university named Federal University Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563682 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'lokoja-national-museum', name: 'Lokoja National Museum', kind: 'museum', lon: 6.7407125, lat: 7.804661, localUnitId: 'lokoja',
      description: 'A mapped museum building named Lokoja National Museum.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1159011373 }, accuracy: 'feature-centroid',
      scene: { roof: 'hipped', sign: 'facade', props: ['tree', 'bench'] },
    },
    {
      id: 'maigaris-palace', name: "Maigari's Palace", kind: 'heritage', lon: 6.7445569, lat: 7.8153075, localUnitId: 'lokoja',
      description: "A mapped historic castle-type building tagged Maigari's Palace in Lokoja.", sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563689 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree'], landmark: 'gate' },
    },
    {
      id: 'lokoja-central-masjid', name: 'Lokoja Central Masjid', kind: 'mosque', lon: 6.7479257, lat: 7.8155733, localUnitId: 'lokoja',
      description: 'A mapped Muslim place of worship named Lokoja Central Masjid.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563690 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'facade', props: ['lamp'] },
    },
    {
      id: 'lokoja-central-mosque', name: 'Central Mosque', kind: 'mosque', lon: 6.6832001, lat: 7.8541941, localUnitId: 'lokoja',
      description: 'A mapped mosque building named Central Mosque in the Lokoja local government.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1545832021 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['planter'] },
    },
    {
      id: 'lokoja-anglican-church', name: 'Anglican church', kind: 'church', lon: 6.7462493, lat: 7.8141755, localUnitId: 'lokoja',
      description: 'A mapped Christian place of worship tagged Anglican in Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563691 }, accuracy: 'mapped-feature',
      scene: { roof: 'gable', sign: 'facade', props: ['tree'] },
    },
    {
      id: 'lokoja-old-market', name: 'Old Market', kind: 'market', lon: 6.7488564, lat: 7.8153022, localUnitId: 'lokoja',
      description: 'A mapped marketplace named Old Market; Wikipedia lists Old Market among the three major Lokoja markets, which sell grains, vegetables and household items.', sourceIds: ['osm-selected', 'wikipedia-lokoja'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563692 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['stall'] }, specialtyIds: ['lokoja-grains-vegetables'],
    },
    {
      id: 'children-amusement-park', name: 'Children Amusement', kind: 'park', lon: 6.7392824, lat: 7.803086, localUnitId: 'lokoja',
      description: 'A mapped park tagged Children Amusement in Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563677 }, accuracy: 'mapped-feature',
      scene: { roof: 'hipped', sign: 'roadside', props: ['tree', 'bench'] },
    },
    {
      id: 'lokoja-international-stadium', name: 'Lokoja International Stadium', kind: 'stadium', lon: 6.6978784, lat: 7.8148717, localUnitId: 'lokoja',
      description: 'A mapped stadium named Lokoja International Stadium.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'node', id: 8851563696 }, accuracy: 'mapped-feature',
      scene: { roof: 'flat', sign: 'roadside', props: ['lamp'] },
    },
    {
      id: 'gtbank-lokoja', name: 'Guarantee Trust Bank', kind: 'savings', lon: 6.7378001, lat: 7.7956903, localUnitId: 'lokoja',
      description: 'A mapped bank building named Guarantee Trust Bank in Lokoja.', sourceIds: ['osm-selected'],
      coordinateSourceId: 'osm-selected', coordinateRef: { provider: 'openstreetmap', element: 'way', id: 1113435755 }, accuracy: 'feature-centroid',
      scene: { roof: 'flat', sign: 'facade', props: ['lamp'] },
    },
  ],
  identity: {
    foods: [
      { id: 'lokoja-grains-vegetables', name: 'Grains and vegetables', description: 'Wikipedia says the essential products sold in the three major Lokoja markets are grains, vegetables and general household items.', sourceIds: ['wikipedia-lokoja'] },
    ],
    crafts: [
      { id: 'lokoja-river-fishing', name: 'Confluence fishing and boat regattas', description: 'Wikipedia says Lokoja fishermen celebrate the Donkwo fishing festival and that boat regattas are held, though not regularly.', sourceIds: ['wikipedia-lokoja'], note: 'A river-livelihood tradition rather than a documented manufactured craft.' },
    ],
    industries: [
      { id: 'lokoja-agricultural-trade', name: 'Agricultural trade at the confluence', description: 'Wikipedia calls Lokoja a trade centre for agricultural products because it sits where the Niger and Benue rivers meet.', sourceIds: ['wikipedia-lokoja'] },
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
    clearLabel: 'Clear dry-season skies', sourceIds: ['wikipedia-lokoja'],
  },
  homePalette: { back: '#a85f4a', left: '#6b3a30', floor: ['#c4a77d', '#5f7a5a'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/lokoja-surface.geojson', bytes: 608826, sha256: 'fe460da8089803e7e5015429dfc38b89aae3b96d1f216c8efd503c84d05b8b01' } },
  sourceGroups: [
    { id: 'osm-selected', title: 'Selected OpenStreetMap records for Lokoja', url: 'https://www.openstreetmap.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'ODbL 1.0', cache: { path: 'scripts/city/research/lokoja/reviewed/osm-selected.json', bytes: 3390, sha256: '664fb35576e03283f47d32b5b3a8cfca69eaac4e40c37c304c35c0a332642ba9' } },
    { id: 'wikidata-selected', title: 'Selected Wikidata entities for Lokoja', url: 'https://www.wikidata.org/', checkedOn: '2026-10-06', supports: ['coordinate', 'identity'], licence: 'CC0 1.0', cache: { path: 'scripts/city/research/lokoja/reviewed/wikidata-selected.json', bytes: 4477, sha256: 'a49c0091a96317f56a81c9ec9bd77fc6a7ece2129c746a506ab9f872b84c670e' } },
    { id: 'geography', title: 'Pinned Nigerian administrative geography', url: 'https://www.geoboundaries.org/', checkedOn: '2026-10-06', supports: ['geography'], licence: 'CC BY 4.0', cache: { path: 'scripts/city/research/lokoja/reviewed/geography.json', bytes: 342, sha256: '6b0a790bfd067d5e279fc5e54a9d7207394d7841719a8cf44f8833974d954c5a' } },
    { id: 'wikipedia-lokoja', title: 'Lokoja (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lokoja', checkedOn: '2026-10-06', supports: ['identity', 'population', 'climate'], licence: 'CC BY-SA 4.0', cache: { path: 'scripts/city/research/lokoja/reviewed/wikipedia-lokoja.json', bytes: 970, sha256: '5dffb5b982ae33c36e59956b3a4c09fd197a121ee1d06a903e6b8ebf7408e1b4' } },
  ],
  unmapped: [
    { kind: 'eatery', note: 'No named eatery with an exact OSM element and a sourced local dish was found in the selected LGAs on 2026-10-06; the Wikidata restaurant points carry no dish source.' },
    { kind: 'garden', note: 'No named garden with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'polling', note: 'No named polling venue with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'road-hub', note: 'No named bus station, motor park or terminal with an exact OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06.' },
    { kind: 'salon', note: 'No salon-tagged OSM element or Wikidata P625 record was found in the selected LGAs on 2026-10-06; an element named Bash Unisex Salon carries only a building tag.' },
  ],
})
