export interface OgunLandmarkPoint {
  id: string; name: string; lon: number; lat: number
  scope: 'abeokuta' | 'ota' | 'ijebu-ode' | 'sagamu' | 'state-coming'
  kind: 'landmark' | 'campus' | 'market' | 'water' | 'transport' | 'route-reference'
  accuracy: 'mapped-feature' | 'feature-centroid' | 'published-point' | 'route-reference' | 'city-reference'
  source: string; licence: string; note?: string
}

const osm = (type: 'node' | 'way' | 'relation', id: number): string => `https://www.openstreetmap.org/${type}/${id}`

/** State-context points remain lazy with the Ogun overview and are not playable city venues. */
export const OGUN_STATE_LANDMARKS: readonly OgunLandmarkPoint[] = Object.freeze([
  {
    id: 'oou-ago-iwoye', name: 'Olabisi Onabanjo University, Ago-Iwoye', lon: 3.87144, lat: 6.92185,
    scope: 'state-coming', kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 789111299),
    licence: 'OpenStreetMap contributors, ODbL 1.0',
    note: 'Main campus in Ijebu North, outside the four opened city footprints. Shown on the state overview as coming.',
  },
  {
    id: 'papalanto-station', name: 'Funmilayo Ransome-Kuti Station, Papalanto', lon: 3.2333598, lat: 6.9133538,
    scope: 'state-coming', kind: 'transport', accuracy: 'mapped-feature', source: osm('node', 9074714198),
    licence: 'OpenStreetMap contributors, ODbL 1.0',
    note: 'Ewekoro reference and freight station. NRC does not confirm current passenger boarding here.',
  },
  { id: 'lagos-abeokuta-expressway', name: 'Lagos–Abeokuta Expressway through Sango-Ota', lon: 3.2428549, lat: 6.7071679, scope: 'state-coming', kind: 'route-reference', accuracy: 'route-reference', source: osm('node', 4247701494), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Sango-Ota route reference; no unsourced full-road trace is bundled.' },
  { id: 'lagos-ibadan-expressway-ogun', name: 'Lagos–Ibadan Expressway through Ogun', lon: 3.5788, lat: 6.8832, scope: 'sagamu', kind: 'route-reference', accuracy: 'mapped-feature', source: osm('way', 281964155), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Sagamu interchange reference: the motorway links where the Lagos–Ibadan Expressway meets the Abeokuta–Sagamu road.' },
  { id: 'mowe', name: 'Mowe on the Lagos–Ibadan Expressway', lon: 3.420896, lat: 6.7777634, scope: 'abeokuta', kind: 'route-reference', accuracy: 'mapped-feature', source: osm('node', 13236988834), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'State-context town in opened Obafemi/Owode.' },
  { id: 'ibafo', name: 'Ibafo on the Lagos–Ibadan Expressway', lon: 3.421874, lat: 6.7424415, scope: 'abeokuta', kind: 'route-reference', accuracy: 'mapped-feature', source: osm('node', 501330754), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'State-context town in opened Obafemi/Owode.' },
  { id: 'awolowo-residence-area', name: 'Chief Obafemi Awolowo residence area, Ikenne', lon: 3.7166694, lat: 6.8666694, scope: 'sagamu', kind: 'landmark', accuracy: 'route-reference', source: 'https://www.wikidata.org/wiki/Q5995826', licence: 'Wikidata, CC0 1.0', note: 'Ikenne locality reference only. It does not claim the museum entrance coordinate.' },
])

export const ABEOKUTA_LANDMARKS: readonly OgunLandmarkPoint[] = Object.freeze([
  { id: 'olumo-rock', name: 'Olumo Rock', lon: 3.3425848, lat: 7.1671952, scope: 'abeokuta', kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 1456801587), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'funaab', name: 'Federal University of Agriculture, Abeokuta', lon: 3.4355762, lat: 7.2236469, scope: 'abeokuta', kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 705301227), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'mko-abiola-stadium', name: 'MKO Abiola Stadium', lon: 3.3552327, lat: 7.1324364, scope: 'abeokuta', kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 316843082), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'centenary-hall', name: 'Centenary Hall', lon: 3.353503, lat: 7.164048, scope: 'abeokuta', kind: 'landmark', accuracy: 'published-point', source: 'https://commons.wikimedia.org/wiki/File:Centenary_Hall,_Abeokuta,_Ogun_State.jpg', licence: 'Wikimedia Commons structured coordinates, CC0; photograph CC BY-SA 4.0' },
  { id: 'oopl', name: 'Olusegun Obasanjo Presidential Library', lon: 3.3640533, lat: 7.1259589, scope: 'abeokuta', kind: 'landmark', accuracy: 'published-point', source: 'https://www.wikidata.org/wiki/Q86339554', licence: 'Wikidata, CC0 1.0' },
  { id: 'cathedral-st-peter', name: 'Cathedral Church of St Peter', lon: 3.3517312, lat: 7.1641226, scope: 'abeokuta', kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 669568923), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'alake-palace', name: "Alake's Palace", lon: 3.35294, lat: 7.164227, scope: 'abeokuta', kind: 'landmark', accuracy: 'published-point', source: 'https://commons.wikimedia.org/wiki/File:Alake%27s_Palace,_Abeokuta,_Ogun.jpg', licence: 'Wikimedia Commons structured coordinates, CC0; photograph CC BY-SA 4.0' },
  { id: 'itoku-market', name: 'Itoku Adire Market', lon: 3.3425, lat: 7.1567, scope: 'abeokuta', kind: 'market', accuracy: 'published-point', source: 'https://www.jiengtech.com/index.php/INDEX/article/download/30/30', licence: 'Published coordinate fact' },
  { id: 'kuto-market', name: 'Kuto Market', lon: 3.350375, lat: 7.1391789, scope: 'abeokuta', kind: 'market', accuracy: 'published-point', source: 'https://www.wikidata.org/wiki/Q108600697', licence: 'Wikidata, CC0 1.0' },
  { id: 'lafenwa-bridge', name: 'Lafenwa Bridge and Ogun River', lon: 3.3288234, lat: 7.1560208, scope: 'abeokuta', kind: 'water', accuracy: 'feature-centroid', source: osm('way', 309305898), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Representative point from the twin OSM bridge ways 309305898 and 309305934.' },
  { id: 'wole-soyinka-station', name: 'Professor Wole Soyinka Station', lon: 3.39847, lat: 7.12885, scope: 'abeokuta', kind: 'transport', accuracy: 'mapped-feature', source: osm('node', 8841632699), licence: 'OpenStreetMap contributors, ODbL 1.0' },
])

export const OTA_LANDMARKS: readonly OgunLandmarkPoint[] = Object.freeze([
  { id: 'covenant-university', name: 'Covenant University', lon: 3.1573472, lat: 6.6719407, scope: 'ota', kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 472426637), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'bells-university', name: 'Bells University of Technology', lon: 3.1697985, lat: 6.6865088, scope: 'ota', kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 1215520865), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'sango-ota', name: 'Sango-Ota', lon: 3.2428549, lat: 6.7071679, scope: 'ota', kind: 'transport', accuracy: 'mapped-feature', source: osm('node', 4247701494), licence: 'OpenStreetMap contributors, ODbL 1.0' },
])

export const IJEBU_ODE_LANDMARKS: readonly OgunLandmarkPoint[] = Object.freeze([
  { id: 'dipo-dina-stadium', name: 'Otunba Dipo Dina International Stadium', lon: 3.9374079, lat: 6.8171253, scope: 'ijebu-ode', kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 617596401), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'ijebu-ode-park', name: 'Ijebu-Ode Lagos Motor Park', lon: 3.9105063, lat: 6.8108372, scope: 'ijebu-ode', kind: 'transport', accuracy: 'mapped-feature', source: osm('node', 5854068985), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'tasued', name: 'Tai Solarin Federal University of Education', lon: 3.93049, lat: 6.79281, scope: 'ijebu-ode', kind: 'campus', accuracy: 'published-point', source: 'https://www.wikidata.org/wiki/Q7675831', licence: 'Wikidata, CC0 1.0', note: 'Institution-specific point. Familiar alias: TASUED.' },
  { id: 'ojude-oba-city-reference', name: 'Ojude Oba cultural city reference — exact ground unverified', lon: 3.9151668, lat: 6.8140077, scope: 'ijebu-ode', kind: 'landmark', accuracy: 'city-reference', source: osm('node', 501496491), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Visible limitation: this is only the mapped Ijebu-Ode city point. No exact open palace or festival-ground coordinate has been verified.' },
])

export const SAGAMU_LANDMARKS: readonly OgunLandmarkPoint[] = Object.freeze([
  { id: 'babcock-university', name: 'Babcock University', lon: 3.7224377, lat: 6.8900559, scope: 'sagamu', kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 453068217), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'mayflower-school', name: 'Mayflower School', lon: 3.7233411, lat: 6.8660562, scope: 'sagamu', kind: 'campus', accuracy: 'published-point', source: 'https://www.wikidata.org/wiki/Q6797236', licence: 'Wikidata, CC0 1.0' },
  { id: 'sagamu-interchange', name: 'Sagamu Interchange', lon: 3.5788, lat: 6.8832, scope: 'sagamu', kind: 'transport', accuracy: 'mapped-feature', source: osm('way', 281964155), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Junction of the Lagos–Ibadan Expressway motorway links with the Abeokuta–Sagamu road (OSM link ways 281964151 to 281964163).' },
])
