/**
 * Verified point catalogue for map overlays. It deliberately contains no hand-drawn road, rail
 * or river lines. Linear features use a sourced reference point until licensed geometry is added.
 */
export interface IbadanLandmarkPoint {
  id: string
  name: string
  lon: number
  lat: number
  kind: 'landmark' | 'campus' | 'market' | 'water' | 'transport' | 'route-reference'
  accuracy: 'mapped-feature' | 'feature-centroid' | 'published-point' | 'route-reference'
  source: string
  licence: string
  note?: string
}

const osm = (type: 'node' | 'way' | 'relation', id: number): string => `https://www.openstreetmap.org/${type}/${id}`

export const IBADAN_LANDMARK_POINTS: readonly IbadanLandmarkPoint[] = Object.freeze([
  { id: 'ui-main-gate', name: 'University of Ibadan main gate', lon: 3.9068, lat: 7.4412, kind: 'campus', accuracy: 'published-point', source: 'https://pdfs.semanticscholar.org/d201/421fdbe7557315c8447bcb6e8878020941b0.pdf', licence: 'Coordinate fact from published field measurements' },
  { id: 'ui-trenchard-hall', name: 'Trenchard Hall', lon: 3.8999596, lat: 7.4449079, kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 364487900), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Mapped building centroid. The OSM name currently reads “Tenchard Hall”; the official University of Ibadan road network confirms the spelling Trenchard Hall.' },
  { id: 'ui-zoo', name: 'University of Ibadan Zoological Garden', lon: 3.8955, lat: 7.4425, kind: 'campus', accuracy: 'published-point', source: 'https://nscbconf2020.wordpress.com/wp-content/uploads/2020/11/39.-nscb2020_051-1.pdf', licence: 'Coordinate fact from a published site survey' },
  { id: 'ui-botanical-garden', name: 'University of Ibadan Botanical Garden', lon: 3.896162, lat: 7.4577452, kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 758353311), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'polytechnic', name: 'The Polytechnic, Ibadan', lon: 3.8837345, lat: 7.4369114, kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 1009823166), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'lead-city', name: 'Lead City University main gate', lon: 3.87577, lat: 7.32637, kind: 'campus', accuracy: 'feature-centroid', source: osm('way', 1264087047), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Main-campus gate on Oba Otudeko Avenue in the Toll Gate area; not the Jericho address.' },
  { id: 'uch', name: 'University College Hospital', lon: 3.9037086, lat: 7.4028275, kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 82467201), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'cocoa-house', name: 'Cocoa House', lon: 3.8788769, lat: 7.3880524, kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 1283222827), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'mapo-hall', name: 'Mapo Hall', lon: 3.8969774, lat: 7.3759998, kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 82244395), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'bowers-tower', name: 'Bower’s Tower', lon: 3.896598, lat: 7.392036, kind: 'landmark', accuracy: 'published-point', source: 'https://www.wikidata.org/wiki/Q108910280', licence: 'Wikidata, CC0 1.0' },
  { id: 'agodi-gardens', name: 'Agodi Gardens', lon: 3.8982644, lat: 7.4093254, kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 758353355), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'bodija-market', name: 'Bodija Market', lon: 3.9157404, lat: 7.4359015, kind: 'market', accuracy: 'mapped-feature', source: osm('node', 2819861343), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'dugbe-market', name: 'Dugbe Market', lon: 3.88040447, lat: 7.3870279, kind: 'market', accuracy: 'published-point', source: 'https://repository.run.edu.ng/server/api/core/bitstreams/9c97fef3-7f13-4e33-92b1-cbb19d6ed606/content', licence: 'Coordinate fact from a published field-measurement table' },
  { id: 'gbagi-market', name: 'Gbagi New International Market', lon: 3.9558975, lat: 7.39337, kind: 'market', accuracy: 'feature-centroid', source: osm('way', 82466578), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'lekan-salami-stadium', name: 'Lekan Salami Stadium at Adamasingba', lon: 3.8853064, lat: 7.3963017, kind: 'landmark', accuracy: 'feature-centroid', source: osm('relation', 17748471), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'national-museum', name: 'National Museum of Unity', lon: 3.868776, lat: 7.384937, kind: 'landmark', accuracy: 'mapped-feature', source: 'https://www.wikidata.org/wiki/Q55113752', licence: 'Wikidata, CC0 1.0' },
  { id: 'iita-forest', name: 'IITA Forest Reserve', lon: 3.8875769, lat: 7.4951861, kind: 'landmark', accuracy: 'feature-centroid', source: osm('relation', 10307392), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Large reserve centroid, not an entrance.' },
  { id: 'eleyele-reservoir', name: 'Eleyele Reservoir', lon: 3.8687741, lat: 7.4333509, kind: 'water', accuracy: 'feature-centroid', source: osm('way', 30050505), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'ogunpa-river', name: 'Ogunpa River', lon: 3.8915202, lat: 7.3604199, kind: 'water', accuracy: 'route-reference', source: osm('relation', 11384438), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Relation centroid only; no unsourced river trace is bundled.' },
  { id: 'iwo-road-interchange', name: 'Iwo Road Interchange', lon: 3.9444816, lat: 7.40288, kind: 'transport', accuracy: 'published-point', source: 'https://hdmi.fmw.gov.ng/user/hdmi/corridors?page=2', licence: 'Coordinate fact published by the Federal Ministry of Works' },
  { id: 'challenge-interchange', name: 'Orita Challenge Interchange', lon: 3.8793, lat: 7.3482, kind: 'transport', accuracy: 'mapped-feature', source: 'https://www.openstreetmap.org/#map=18/7.3482/3.8793', licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'The junction where Challenge Road, the Lagos–Ibadan expressway (A1) and Ring Road meet in the bundled OpenStreetMap roads. An earlier point (the mapped police station, 3.8700 E 7.3379 N) lay about 1.5 km south-west of the junction, inside Oluyole; the junction itself is inside Ibadan South-East.' },
  { id: 'lagos-ibadan-expressway', name: 'Lagos–Ibadan Expressway', lon: 3.9142013, lat: 7.3636311, kind: 'route-reference', accuracy: 'route-reference', source: osm('way', 30045325), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Representative mapped way segment; no unsourced full-road trace is bundled.' },
  { id: 'lagos-ibadan-railway', name: 'Lagos–Ibadan railway', lon: 3.896621, lat: 7.559368, kind: 'route-reference', accuracy: 'route-reference', source: osm('way', 863990411), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Station reference point; no unsourced full-rail trace is bundled.' },
  { id: 'moniya-station', name: 'Obafemi Awolowo Station, Moniya', lon: 3.896621, lat: 7.559368, kind: 'transport', accuracy: 'feature-centroid', source: osm('way', 863990411), licence: 'OpenStreetMap contributors, ODbL 1.0' },
  { id: 'ring-road', name: 'Ring Road', lon: 3.8586542, lat: 7.3755249, kind: 'route-reference', accuracy: 'route-reference', source: osm('way', 230958890), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Representative mapped road segment; no unsourced full-road trace is bundled.' },
  { id: 'olubadan-palace-current', name: 'Aafin Olubadan Ile Ibadan, Oke Aremo', lon: 3.8995081, lat: 7.3877291, kind: 'landmark', accuracy: 'published-point', source: 'https://olubadan.com/visit/', licence: 'Coordinate fact from the named geocoded destination; official palace site verifies the present Oke Aremo identity', note: 'Opened in July 2024; kept separate from the historic Oja’ba palace marker.' },
  { id: 'olubadan-palace-historic', name: 'Historic Olubadan palace at Oja’ba', lon: 3.8962389, lat: 7.3745468, kind: 'landmark', accuracy: 'feature-centroid', source: osm('way', 82244400), licence: 'OpenStreetMap contributors, ODbL 1.0', note: 'Historic palace marker; this is not labelled as the present Oke Aremo palace.' },
])

/**
 * OSM relation 10699301 as two connected-within-the-source polylines. The relation has a 23.4 m
 * topological gap between nodes 11936864570 and 6287057206 near 6.948 N; the catalogue preserves
 * that gap instead of inventing a bend. Points are Douglas-Peucker simplified from relation member
 * ways at 0.0005 degrees while preserving source vertices and segment endpoints.
 */
export const IBADAN_RAIL_ROUTE = Object.freeze({
  id: 'lagos-ibadan-sgr',
  name: 'Lagos–Ibadan standard-gauge railway',
  source: 'https://www.openstreetmap.org/relation/10699301',
  sourceApi: 'https://api.openstreetmap.org/api/0.6/relation/10699301/full',
  sourceSha256: '1722b1a590981631d70d570871c9546b6dbd1518249c3635037093f8a3323c92',
  licence: 'OpenStreetMap contributors, ODbL 1.0',
  gap: Object.freeze({
    fromNode: '11936864570', toNode: '6287057206', metres: 23.4,
    from: [3.2538897, 6.9480283] as const, to: [3.2539379, 6.9482334] as const,
  }),
  segments: Object.freeze([
    Object.freeze([
      [3.3736608, 6.5017566], [3.3757857, 6.4966404], [3.3225106, 6.6286301], [3.321806, 6.6338765],
      [3.32282, 6.6528305], [3.3217319, 6.6579929], [3.2793296, 6.7233907], [3.2687671, 6.7352976],
      [3.2569929, 6.7560776], [3.2533658, 6.7662062], [3.2442758, 6.776679], [3.2418516, 6.7863939],
      [3.236549, 6.7963483], [3.2261869, 6.8319383], [3.222497, 6.8570509], [3.2226848, 6.8869331],
      [3.2234573, 6.8926848], [3.2262468, 6.9005667], [3.2538897, 6.9480283],
    ] as const),
    Object.freeze([
      [3.2539379, 6.9482334], [3.2612657, 6.9681751], [3.2714366, 6.9826584], [3.2968755, 7.0421626],
      [3.3012727, 7.049508], [3.3062458, 7.0549857], [3.3419895, 7.0844116], [3.3458089, 7.0866261],
      [3.357439, 7.0899905], [3.3632755, 7.0932697], [3.3690337, 7.0994804], [3.3762014, 7.1124827],
      [3.3869305, 7.1242979], [3.3908141, 7.1262982], [3.4175254, 7.1353486], [3.4237756, 7.1390841],
      [3.4295797, 7.1452228], [3.4632682, 7.1872494], [3.4700059, 7.1935083], [3.5379409, 7.2319116],
      [3.547039, 7.2386808], [3.5628748, 7.2540921], [3.5838041, 7.2671872], [3.6068814, 7.2920571],
      [3.625059, 7.3052606], [3.6299514, 7.3096875], [3.6584154, 7.3412344], [3.6696226, 7.3517075],
      [3.6812916, 7.3597205], [3.6894807, 7.3670481], [3.6975806, 7.3774962], [3.701994, 7.3817846],
      [3.7198442, 7.3940584], [3.7604406, 7.4166642], [3.7653021, 7.420205], [3.7860674, 7.4428374],
      [3.7984112, 7.453777], [3.8102819, 7.4684436], [3.8327345, 7.4893119], [3.8571453, 7.5276172],
      [3.8708896, 7.5410724], [3.9000608, 7.5622502], [3.8964268, 7.5595266],
    ] as const),
  ]),
})
