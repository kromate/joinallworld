export interface PortHarcourtLandmark {
  id: string; name: string; lon: number; lat: number
  kind: 'landmark' | 'campus' | 'market' | 'water' | 'transport' | 'industrial' | 'route-reference'
  accuracy: 'mapped-feature' | 'feature-centroid' | 'published-point' | 'route-reference'
  source: string; licence: string; note?: string
}
const osm = (type: 'node' | 'way' | 'relation', id: number): string => `https://www.openstreetmap.org/${type}/${id}`

export const PORT_HARCOURT_LANDMARKS: readonly PortHarcourtLandmark[] = Object.freeze([
  { id:'pleasure-park',name:'Port Harcourt Pleasure Park',lon:7.0115139,lat:4.8375095,kind:'landmark',accuracy:'feature-centroid',source:osm('relation',10577020),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'isaac-boro-park',name:'Isaac Boro Park',lon:7.0054726,lat:4.788293,kind:'landmark',accuracy:'feature-centroid',source:osm('way',758353197),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'mile-one-market',name:'New Mile One Market',lon:6.9979166,lat:4.7925234,kind:'market',accuracy:'feature-centroid',source:osm('way',547047428),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'mile-three-market',name:'Mile Three Market locality',lon:6.992341,lat:4.804663,kind:'market',accuracy:'published-point',source:'https://rsisinternational.org/journals/ijrsi/articles/evaluation-of-access-to-drinking-water-sources-in-port-harcourt-rivers-state/',licence:'Published field-coordinate fact',note:'Nkpolu-Oroworukwo locality reference; not a surveyed market gate.' },
  { id:'oil-mill-market',name:'Oil Mill Market',lon:7.0653907,lat:4.8577216,kind:'market',accuracy:'mapped-feature',source:osm('node',11569747509),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'railway-station',name:'Port Harcourt Railway Station',lon:7.0164659,lat:4.7650949,kind:'transport',accuracy:'mapped-feature',source:osm('node',1855084842),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'wharf-road',name:'Port Harcourt wharf and seaport reference',lon:7.0077827,lat:4.7693656,kind:'transport',accuracy:'route-reference',source:osm('way',175144772),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Wharf Road reference; not a surveyed berth entrance.' },
  { id:'rsu',name:'Rivers State University',lon:6.9807492,lat:4.7969856,kind:'campus',accuracy:'feature-centroid',source:osm('relation',10559059),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'uniport',name:'University of Port Harcourt, Choba',lon:6.9158749,lat:4.8940715,kind:'campus',accuracy:'mapped-feature',source:osm('way',501513118),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Institute of Petroleum Studies campus feature at Choba.' },
  { id:'iaue',name:'Ignatius Ajuru University of Education',lon:6.9309744,lat:4.8041686,kind:'campus',accuracy:'mapped-feature',source:osm('way',547202537),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Mapped History Extension feature on the Rumuolumeni campus.' },
  { id:'yakubu-gowon-stadium',name:'Yakubu Gowon Stadium',lon:7.0219237,lat:4.8249177,kind:'landmark',accuracy:'feature-centroid',source:osm('way',178248417),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'adokiye-stadium',name:'Adokiye Amiesimaka Stadium',lon:6.9714235,lat:4.9675311,kind:'landmark',accuracy:'feature-centroid',source:osm('way',519343267),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'garden-city-amusement',name:'Garden City Amusement Park address reference',lon:6.9981336,lat:4.8281193,kind:'landmark',accuracy:'route-reference',source:osm('way',561455464),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Birabi Street reference matching the park’s official Plot 41A/9 address; not a surveyed entrance point.' },
  { id:'tourist-beach',name:'Port Harcourt Tourist Beach',lon:7.0122039,lat:4.759365,kind:'water',accuracy:'published-point',source:'https://www.wikidata.org/wiki/Q39047321',licence:'Wikidata, CC0 1.0',note:'Published area marker on land, about 0.5 km from the derived water edge; not a surveyed shoreline access point.' },
  { id:'bonny-jetty',name:'Bonny/Nembe Waterside ferry terminal',lon:7.0247212,lat:4.7576372,kind:'transport',accuracy:'mapped-feature',source:osm('node',9756977072),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Port Harcourt ferry terminal; not Bonny Island.' },
  { id:'okrika-jetty',name:'Okrika town landing',lon:7.0823282,lat:4.7471189,kind:'transport',accuracy:'feature-centroid',source:osm('way',773811599),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Mapped pier in Okrika town; the object is unnamed.' },
  { id:'trans-amadi',name:'Trans-Amadi Industrial Layout',lon:7.0412027,lat:4.8201471,kind:'industrial',accuracy:'mapped-feature',source:osm('node',5599585544),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'eleme-refinery',name:'Port Harcourt Refinery complex',lon:7.107784,lat:4.7605332,kind:'industrial',accuracy:'feature-centroid',source:osm('way',308267796),licence:'OpenStreetMap contributors, ODbL 1.0',note:'The mapped industrial way crosses the Eleme–Okrika boundary; its centroid falls in Okrika, while the official address is Alesa-Eleme.' },
  { id:'airport',name:'Port Harcourt International Airport',lon:6.9518013,lat:5.0165409,kind:'transport',accuracy:'feature-centroid',source:osm('way',382275447),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'government-house',name:'Rivers State Government House area',lon:7.0167428,lat:4.7765377,kind:'landmark',accuracy:'feature-centroid',source:osm('way',754697673),licence:'OpenStreetMap contributors, ODbL 1.0' },
  { id:'rumuola-flyover',name:'Rumuola flyover area',lon:6.9982413,lat:4.8340294,kind:'route-reference',accuracy:'route-reference',source:osm('way',173874600),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Mapped Rumuola/Rumuokwuta Road segment. The road object does not survey the flyover span.' },
  { id:'garrison-flyover',name:'Garrison flyover area',lon:7.0158029,lat:4.8093164,kind:'route-reference',accuracy:'route-reference',source:osm('way',178353853),licence:'OpenStreetMap contributors, ODbL 1.0',note:'Mapped Garrison Road bridge segment, not a surveyed flyover entrance.' },
])
