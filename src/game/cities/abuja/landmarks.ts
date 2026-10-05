export interface AbujaLandmark {
 readonly id:string; readonly name:string; readonly lon:number; readonly lat:number
 readonly kind:'landmark'|'campus'|'market'|'water'|'transport'|'backdrop'|'context'
 readonly accuracy:'mapped-feature'|'feature-centroid'|'published-point'; readonly source:string; readonly licence:string; readonly note:string
 readonly context?:string
}
export const ABUJA_LANDMARKS:readonly AbujaLandmark[] = Object.freeze([
  {
    "id": "national-mosque",
    "name": "Abuja National Mosque",
    "lon": 7.4888576,
    "lat": 9.0597485,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/12186054",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "christian-centre",
    "name": "National Christian Centre",
    "lon": 7.4951095,
    "lat": 9.0517395,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/640533361",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "millennium-park",
    "name": "Millennium Park",
    "lon": 7.4977431,
    "lat": 9.069431,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/12181857",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "national-stadium",
    "name": "Moshood Abiola National Stadium",
    "lon": 7.4529637,
    "lat": 9.0369044,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/13989805",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "velodrome",
    "name": "Abuja Velodrome",
    "lon": 7.4573368,
    "lat": 9.0390918,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/223440553",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "eagle-square",
    "name": "Abuja Eagle Square",
    "lon": 7.4998156,
    "lat": 9.0609467,
    "kind": "landmark",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/44158551",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "arts-village",
    "name": "Arts and Craft Village",
    "lon": 7.4851501,
    "lat": 9.0655759,
    "kind": "market",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/12195304",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "wuse-market",
    "name": "Wuse Market",
    "lon": 7.4660294,
    "lat": 9.0687827,
    "kind": "market",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/299203155",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "garki-market",
    "name": "Garki Market",
    "lon": 7.4915319,
    "lat": 9.0219556,
    "kind": "market",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/1288724626",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "usuma-dam",
    "name": "Usuma Dam",
    "lon": 7.4150755,
    "lat": 9.2002555,
    "kind": "water",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/558353875",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "uniabuja",
    "name": "University of Abuja",
    "lon": 7.1762922,
    "lat": 8.9789028,
    "kind": "campus",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/1133000152",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "nile-university",
    "name": "Nile University",
    "lon": 7.3988759,
    "lat": 9.0144382,
    "kind": "campus",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/776206187",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Mapped campus Car Park A reference; not a surveyed main gate."
  },
  {
    "id": "baze-university",
    "name": "Baze University",
    "lon": 7.404622,
    "lat": 9.0061589,
    "kind": "campus",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/798017176",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "airport",
    "name": "Nnamdi Azikiwe International Airport",
    "lon": 7.2736735,
    "lat": 9.0130994,
    "kind": "transport",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/10749710",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "city-gate",
    "name": "Abuja City Gate",
    "lon": 7.4486196,
    "lat": 9.0356979,
    "kind": "transport",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/563951535",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "presidential-villa",
    "name": "Aso Rock Presidential Villa",
    "lon": 7.5197328,
    "lat": 9.0611612,
    "kind": "backdrop",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/12208955",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance. Protected government site shown only as an exterior backdrop; no entry activity."
  },
  {
    "id": "national-assembly",
    "name": "National Assembly of Nigeria",
    "lon": 7.5101834,
    "lat": 9.0691611,
    "kind": "backdrop",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/relation/12207646",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance. Protected government site shown only as an exterior backdrop; no entry activity."
  },
  {
    "id": "supreme-court",
    "name": "Supreme Court of Nigeria",
    "lon": 7.5074377,
    "lat": 9.0610962,
    "kind": "backdrop",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/188280983",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance. Protected government site shown only as an exterior backdrop; no entry activity."
  },
  {
    "id": "zuma-rock",
    "name": "Zuma Rock — Niger State",
    "lon": 7.2341492,
    "lat": 9.1305765,
    "kind": "context",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/28934463",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "context": "Niger State · context only; boundary datasets differ",
    "note": "Federal and Niger tourism authorities place Zuma Rock in Niger State. The pinned gbOpen and OSM administrative layers include this exact point in FCT; the source point and boundaries are retained, and no Abuja council membership is inferred for this non-enterable landmark."
  },
  {
    "id": "jabi-lake",
    "name": "Jabi Reservoir",
    "lon": 7.4222269,
    "lat": 9.0754357,
    "kind": "water",
    "accuracy": "feature-centroid",
    "source": "https://www.openstreetmap.org/way/114132918",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "aso-rock",
    "name": "Aso Rock",
    "lon": 7.534132,
    "lat": 9.0833242,
    "kind": "backdrop",
    "accuracy": "mapped-feature",
    "source": "https://www.openstreetmap.org/node/8210141336",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "children-zoo",
    "name": "National Park and Zoo",
    "lon": 7.5250229,
    "lat": 9.0807378,
    "kind": "landmark",
    "accuracy": "mapped-feature",
    "source": "https://www.openstreetmap.org/node/10262232818",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "idu-station",
    "name": "Idu",
    "lon": 7.3424175,
    "lat": 9.0470806,
    "kind": "transport",
    "accuracy": "mapped-feature",
    "source": "https://www.openstreetmap.org/node/5754031475",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "utako-hub",
    "name": "Utako Motor And Bus Terminal",
    "lon": 7.435012,
    "lat": 9.0657905,
    "kind": "transport",
    "accuracy": "mapped-feature",
    "source": "https://www.openstreetmap.org/node/14024364208",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "three-arms-zone",
    "name": "Three Arms Zone — exterior context",
    "lon": 7.5074377,
    "lat": 9.0610962,
    "kind": "backdrop",
    "accuracy": "mapped-feature",
    "source": "https://www.openstreetmap.org/way/188280983",
    "licence": "OpenStreetMap contributors, ODbL 1.0",
    "note": "Supreme Court feature reference in the Three Arms Zone. Government compounds are backdrops only."
  }
,
{
  "id": "jabi-lake-park",
  "name": "Jabi Lake Park",
  "lon": 7.417552471160889,
  "lat": 9.073736071586609,
  "kind": "landmark",
  "accuracy": "published-point",
  "source": "https://kubanni-backend.abu.edu.ng/server/api/core/bitstreams/1f2bd815-1b2a-42ea-bc25-7a712a3bbc30/content",
  "licence": "Published coordinate fact; no source prose or map reproduced",
  "note": "Table 3.1 field-study park point; not a surveyed entrance. Park identity also documented by FCTA tourism."
}])
