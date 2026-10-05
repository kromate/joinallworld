/**
 * A stylised, north-up model of the University of Lagos Akoka campus.
 *
 * World x increases east and world z increases south. The positions preserve
 * the useful compass relationships in the cited map sources, but distances are
 * deliberately compressed for a walkable social world. They are not survey
 * coordinates and must not be used for navigation outside the game.
 */

import { landmarkLabel } from './spot-names.ts';

const STUDY_MAP = 'https://assets-eu.researchsquare.com/files/rs-2926408/v1/fc6eeb08-d1ff-422a-8880-e4baab439b27.pdf?c=1689601461#page=13';
const FIELD_MAP = 'User brief from the UNILAG campus-map interpretation; placement approximate';

export type Confidence = 'high' | 'medium' | 'low';

export interface Portal {
  /** Stable portal identifier, shared by its two zones. */
  id: string;
  /** Adjacent zone identifier. */
  to: string;
  /** Walkable point just inside this zone. */
  at: { x: number; z: number };
  /** Walkable point just inside the adjacent zone. */
  peer: { x: number; z: number };
}

export interface CampusZone {
  /** Stable zone identifier. */
  id: string;
  /** Display name. */
  label: string;
  /** [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number];
  /** Surface type. */
  kind: 'campus' | 'waterfront';
  /** Adjacent zone identifiers. */
  neighbours: string[];
  /** Cross-zone walking connections. */
  portals: Portal[];
  /** Human-readable coverage note. */
  description: string;
}

export interface CampusBuilding {
  /** Stable landmark identifier. */
  id: string;
  label: string;
  /** Owning zone identifier. */
  zone: string;
  /** Centre x coordinate. */
  x: number;
  /** Centre z coordinate. */
  z: number;
  /** Width along x. */
  w: number;
  /** Depth along z. */
  d: number;
  /** Visual height. */
  h: number;
  kind: 'faculty' | 'hall' | 'administration' | 'academic' | 'services' | 'worship' | 'gate' | 'open-space';
  /** CSS colour used by a scene renderer. */
  color: string;
  /** Whether the south facade is open into a usable room. */
  interior: boolean;
  /** Confidence in relative placement; never exact-coordinate confidence. */
  confidence: Confidence;
  /** Placement source or qualification. */
  source: string;
}

export interface CampusAnchor {
  /** Stable anchor identifier. */
  id: string;
  /** Building reached by this anchor. */
  building: string;
  label: string;
  /** Owning zone identifier. */
  zone: string;
  /** World x coordinate. */
  x: number;
  /** World floor height. */
  y: number;
  /** World z coordinate. */
  z: number;
  /** Facing in radians; all anchors face north toward a south facade. */
  ry: number;
  /** Whether the destination is inside or outside. */
  kind: 'interior' | 'approach';
  /** The landmark key of the scene (the building id). */
  landmark: string;
}

export interface CampusRoad {
  id: string;
  label: string;
  kind: 'road';
  width: number;
  points: Array<[number, number]>;
  source?: string;
}

const portal = (id: string, to: string, x: number, z: number, peerX: number, peerZ: number): Portal => ({
  id, to, at: { x, z }, peer: { x: peerX, z: peerZ },
});

export const ZONES: CampusZone[] = [
  {
    id: 'gate', label: 'Main Gate & El-Kanemi', bounds: [-300, -240, -100, -80], kind: 'campus',
    description: 'Western arrival and the main-gate approach.',
    neighbours: ['new-hall', 'sports'], portals: [
      portal('gate-new-hall', 'new-hall', -100.5, -160, -99.5, -160),
      portal('gate-sports', 'sports', -200, -80.5, -200, -79.5),
    ],
  },
  {
    id: 'new-hall', label: 'New Hall', bounds: [-100, -240, 100, -80], kind: 'campus',
    description: 'Northern student residences and their southern services.',
    neighbours: ['gate', 'academic', 'gardens'], portals: [
      portal('gate-new-hall', 'gate', -99.5, -160, -100.5, -160),
      portal('new-hall-academic', 'academic', 99.5, -160, 100.5, -160),
      portal('new-hall-gardens', 'gardens', 0, -80.5, 0, -79.5),
    ],
  },
  {
    id: 'academic', label: 'Academic Core', bounds: [100, -240, 300, -80], kind: 'campus',
    description: 'Library, Senate, Arts, Law, Management and auditorium core.',
    neighbours: ['new-hall', 'science', 'lagoon'], portals: [
      portal('new-hall-academic', 'new-hall', 100.5, -160, 99.5, -160),
      portal('academic-science', 'science', 200, -80.5, 200, -79.5),
      portal('academic-lagoon', 'lagoon', 299.5, -160, 300.5, -160),
    ],
  },
  {
    id: 'sports', label: 'Education & Sports', bounds: [-300, -80, -100, 80], kind: 'campus',
    description: 'Education, western halls, worship buildings and sports grounds.',
    neighbours: ['gate', 'gardens', 'second-gate'], portals: [
      portal('gate-sports', 'gate', -200, -79.5, -200, -80.5),
      portal('sports-gardens', 'gardens', -100.5, 0, -99.5, 0),
      portal('sports-second-gate', 'second-gate', -200, 79.5, -200, 80.5),
    ],
  },
  {
    id: 'gardens', label: 'Central Gardens', bounds: [-100, -80, 100, 80], kind: 'campus',
    description: 'Student services, Moremi and the medical-gardens edge.',
    neighbours: ['new-hall', 'sports', 'science', 'dli'], portals: [
      portal('new-hall-gardens', 'new-hall', 0, -79.5, 0, -80.5),
      portal('sports-gardens', 'sports', -99.5, 0, -100.5, 0),
      portal('gardens-science', 'science', 99.5, 0, 100.5, 0),
      portal('gardens-dli', 'dli', 0, 79.5, 0, 80.5),
    ],
  },
  {
    id: 'science', label: 'Engineering & Science', bounds: [100, -80, 300, 80], kind: 'campus',
    description: 'Engineering, Science, Pharmacy and eastern residences.',
    neighbours: ['academic', 'gardens', 'south', 'lagoon'], portals: [
      portal('academic-science', 'academic', 200, -79.5, 200, -80.5),
      portal('gardens-science', 'gardens', 100.5, 0, 99.5, 0),
      portal('science-south', 'south', 200, 79.5, 200, 80.5),
      portal('science-lagoon', 'lagoon', 299.5, 0, 300.5, 0),
    ],
  },
  {
    id: 'second-gate', label: 'Second Gate', bounds: [-300, 80, -100, 240], kind: 'campus',
    description: 'Iwaya-side arrival and Honours Hall.',
    neighbours: ['sports', 'dli'], portals: [
      portal('sports-second-gate', 'sports', -200, 80.5, -200, 79.5),
      portal('second-gate-dli', 'dli', -100.5, 160, -99.5, 160),
    ],
  },
  {
    id: 'dli', label: 'DLI', bounds: [-100, 80, 100, 240], kind: 'campus',
    description: 'Distance Learning Institute and the southern central walk.',
    neighbours: ['gardens', 'second-gate', 'south'], portals: [
      portal('gardens-dli', 'gardens', 0, 80.5, 0, 79.5),
      portal('second-gate-dli', 'second-gate', -99.5, 160, -100.5, 160),
      portal('dli-south', 'south', 99.5, 160, 100.5, 160),
    ],
  },
  {
    id: 'south', label: 'South Campus', bounds: [100, 80, 300, 240], kind: 'campus',
    description: 'Quiet southern campus and the lagoon-side approach.',
    neighbours: ['science', 'dli', 'lagoon'], portals: [
      portal('science-south', 'science', 200, 80.5, 200, 79.5),
      portal('dli-south', 'dli', 100.5, 160, 99.5, 160),
      portal('south-lagoon', 'lagoon', 299.5, 160, 300.5, 160),
    ],
  },
  {
    id: 'lagoon', label: 'Lagoon Front', bounds: [300, -240, 400, 240], kind: 'waterfront',
    description: 'Walkable promenade from x 300 to 340; shoreline water begins at x 340.',
    neighbours: ['academic', 'science', 'south'], portals: [
      portal('academic-lagoon', 'academic', 300.5, -160, 299.5, -160),
      portal('science-lagoon', 'science', 300.5, 0, 299.5, 0),
      portal('south-lagoon', 'south', 300.5, 160, 299.5, 160),
    ],
  },
];

export const BUILDINGS: CampusBuilding[] = [
  { id: 'main-gate', label: landmarkLabel('main-gate'), zone: 'gate', x: -286, z: -105, w: 18, d: 5, h: 8, kind: 'gate', color: '#8f2434', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'el-kanemi-hall', label: landmarkLabel('el-kanemi-hall'), zone: 'gate', x: -246, z: -151, w: 28, d: 20, h: 13, kind: 'hall', color: '#c67f4d', interior: false, confidence: 'medium', source: STUDY_MAP },

  { id: 'eni-njoku-hall', label: landmarkLabel('eni-njoku-hall'), zone: 'new-hall', x: -76, z: -204, w: 24, d: 18, h: 15, kind: 'hall', color: '#ba6d43', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'sodeinde-hall', label: landmarkLabel('sodeinde-hall'), zone: 'new-hall', x: -39, z: -204, w: 24, d: 18, h: 15, kind: 'hall', color: '#bb7548', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'makama-hall', label: landmarkLabel('makama-hall'), zone: 'new-hall', x: 0, z: -204, w: 24, d: 18, h: 15, kind: 'hall', color: '#bd7c4e', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'fagunwa-hall', label: landmarkLabel('fagunwa-hall'), zone: 'new-hall', x: 39, z: -204, w: 24, d: 18, h: 15, kind: 'hall', color: '#b66b45', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'tinubu-hall', label: landmarkLabel('tinubu-hall'), zone: 'new-hall', x: 76, z: -204, w: 24, d: 18, h: 15, kind: 'hall', color: '#b97553', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'cafeteria', label: landmarkLabel('cafeteria'), zone: 'new-hall', x: -24, z: -105, w: 18, d: 12, h: 7, kind: 'services', color: '#d59c50', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'access-bank', label: landmarkLabel('access-bank'), zone: 'new-hall', x: 25, z: -105, w: 20, d: 12, h: 8, kind: 'services', color: '#e36b32', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'new-hall-shopping', label: landmarkLabel('new-hall-shopping'), zone: 'new-hall', x: 68, z: -111, w: 24, d: 14, h: 8, kind: 'services', color: '#b9824d', interior: true, confidence: 'medium', source: STUDY_MAP },

  { id: 'arts', label: landmarkLabel('arts'), zone: 'academic', x: 138, z: -203, w: 28, d: 20, h: 13, kind: 'faculty', color: '#b56b57', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'law', label: landmarkLabel('law'), zone: 'academic', x: 185, z: -210, w: 28, d: 20, h: 14, kind: 'faculty', color: '#9f6658', interior: false, confidence: 'high', source: 'Mapcarta adjacency: north-west of the library; compressed distance' },
  { id: 'management', label: landmarkLabel('management'), zone: 'academic', x: 245, z: -222, w: 30, d: 18, h: 15, kind: 'faculty', color: '#ab7655', interior: true, confidence: 'medium', source: 'Mapcarta N6122566947; compressed placement' },
  { id: 'library', label: landmarkLabel('library'), zone: 'academic', x: 247, z: -186, w: 32, d: 22, h: 16, kind: 'academic', color: '#8f6b53', interior: true, confidence: 'medium', source: 'Mapcarta N6122566943; compressed placement' },
  { id: 'senate', label: landmarkLabel('senate'), zone: 'academic', x: 203, z: -165, w: 28, d: 22, h: 42, kind: 'administration', color: '#a16e4b', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'auditorium', label: landmarkLabel('auditorium'), zone: 'academic', x: 247, z: -132, w: 34, d: 22, h: 14, kind: 'academic', color: '#ad7957', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'uba-bank', label: landmarkLabel('uba-bank'), zone: 'academic', x: 275, z: -165, w: 16, d: 10, h: 7, kind: 'services', color: '#b5282f', interior: false, confidence: 'medium', source: STUDY_MAP },

  { id: 'environmental', label: landmarkLabel('environmental'), zone: 'sports', x: -220, z: -42, w: 28, d: 19, h: 12, kind: 'faculty', color: '#9d7854', interior: false, confidence: 'high', source: 'Mapcarta adjacency: north-east of Education; compressed distance' },
  { id: 'education-chapel', label: landmarkLabel('education-chapel'), zone: 'sports', x: -170, z: -55, w: 18, d: 14, h: 11, kind: 'worship', color: '#8e7b65', interior: false, confidence: 'high', source: 'Mapcarta adjacency W650873126; compressed distance' },
  { id: 'central-mosque', label: landmarkLabel('central-mosque'), zone: 'sports', x: -136, z: -61, w: 20, d: 15, h: 12, kind: 'worship', color: '#4f8862', interior: false, confidence: 'high', source: 'Mapcarta adjacency W1286088886; compressed distance' },
  { id: 'henry-carr-hall', label: landmarkLabel('henry-carr-hall'), zone: 'sports', x: -276, z: -47, w: 24, d: 16, h: 11, kind: 'academic', color: '#a87955', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'wema-bank', label: landmarkLabel('wema-bank'), zone: 'sports', x: -246, z: -25, w: 16, d: 10, h: 7, kind: 'services', color: '#7550a3', interior: false, confidence: 'high', source: 'Mapcarta adjacency: north-east of Education; compressed distance' },
  { id: 'education', label: landmarkLabel('education'), zone: 'sports', x: -270, z: 0, w: 30, d: 21, h: 13, kind: 'faculty', color: '#b98552', interior: false, confidence: 'medium', source: 'Mapcarta N6122566937; compressed placement' },
  { id: 'multipurpose-hall', label: landmarkLabel('multipurpose-hall'), zone: 'sports', x: -220, z: 27, w: 29, d: 20, h: 12, kind: 'academic', color: '#8c6b50', interior: false, confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  { id: 'social-sciences', label: landmarkLabel('social-sciences'), zone: 'sports', x: -145, z: 31, w: 30, d: 20, h: 13, kind: 'faculty', color: '#a67554', interior: true, confidence: 'medium', source: 'Mapcarta N6122566933; compressed placement' },
  { id: 'queen-amina-hall', label: landmarkLabel('queen-amina-hall'), zone: 'sports', x: -272, z: 48, w: 26, d: 18, h: 14, kind: 'hall', color: '#b46f51', interior: false, confidence: 'high', source: 'Mapcarta adjacency: south of Education; compressed distance' },
  { id: 'kofo-hall', label: landmarkLabel('kofo-hall'), zone: 'sports', x: -235, z: 67, w: 24, d: 17, h: 13, kind: 'hall', color: '#bc7952', interior: false, confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  { id: 'biobaku-hall', label: landmarkLabel('biobaku-hall'), zone: 'sports', x: -190, z: 65, w: 24, d: 17, h: 13, kind: 'hall', color: '#ae6748', interior: false, confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  { id: 'sports-centre', label: landmarkLabel('sports-centre'), zone: 'sports', x: -165, z: -15, w: 38, d: 26, h: 1, kind: 'open-space', color: '#5d9660', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'swimming-pool', label: landmarkLabel('swimming-pool'), zone: 'sports', x: -124, z: -35, w: 20, d: 12, h: 1, kind: 'open-space', color: '#4d91a8', interior: false, confidence: 'high', source: 'Mapcarta W707208516 adjacency: north of the sports grounds; compressed distance' },
  { id: 'amphitheatre', label: landmarkLabel('amphitheatre'), zone: 'sports', x: -117, z: 63, w: 26, d: 20, h: 4, kind: 'open-space', color: '#998267', interior: false, confidence: 'medium', source: STUDY_MAP },

  { id: 'student-union', label: landmarkLabel('student-union'), zone: 'gardens', x: -54, z: -30, w: 28, d: 19, h: 11, kind: 'services', color: '#b98048', interior: false, confidence: 'low', source: FIELD_MAP },
  { id: 'university-bookshop', label: landmarkLabel('university-bookshop'), zone: 'gardens', x: -16, z: -31, w: 20, d: 15, h: 8, kind: 'services', color: '#9a7656', interior: false, confidence: 'low', source: FIELD_MAP },
  { id: 'moremi-hall', label: landmarkLabel('moremi-hall'), zone: 'gardens', x: 72, z: -32, w: 26, d: 19, h: 14, kind: 'hall', color: '#bd7451', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'medical-centre', label: landmarkLabel('medical-centre'), zone: 'gardens', x: 5, z: 35, w: 30, d: 20, h: 11, kind: 'services', color: '#a67a5e', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'medical-gardens', label: landmarkLabel('medical-gardens'), zone: 'gardens', x: 63, z: 43, w: 42, d: 30, h: 1, kind: 'open-space', color: '#5d9764', interior: false, confidence: 'low', source: FIELD_MAP },

  { id: 'jaja-hall', label: landmarkLabel('jaja-hall'), zone: 'science', x: 134, z: -42, w: 25, d: 18, h: 14, kind: 'hall', color: '#b76e49', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'engineering', label: landmarkLabel('engineering'), zone: 'science', x: 220, z: -42, w: 32, d: 22, h: 15, kind: 'faculty', color: '#9c7656', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'mariere-hall', label: landmarkLabel('mariere-hall'), zone: 'science', x: 147, z: 27, w: 25, d: 18, h: 14, kind: 'hall', color: '#af694b', interior: true, confidence: 'medium', source: STUDY_MAP },
  { id: 'pharmacy', label: landmarkLabel('pharmacy'), zone: 'science', x: 198, z: 33, w: 28, d: 19, h: 13, kind: 'faculty', color: '#a27a5a', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'science', label: landmarkLabel('science'), zone: 'science', x: 252, z: 37, w: 32, d: 22, h: 14, kind: 'faculty', color: '#9f7552', interior: false, confidence: 'medium', source: STUDY_MAP },

  { id: 'honours-hall', label: landmarkLabel('honours-hall'), zone: 'second-gate', x: -244, z: 174, w: 28, d: 20, h: 13, kind: 'hall', color: '#b5724f', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'second-gate', label: landmarkLabel('second-gate'), zone: 'second-gate', x: -282, z: 222, w: 18, d: 5, h: 8, kind: 'gate', color: '#8f2434', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'dli-building', label: landmarkLabel('dli-building'), zone: 'dli', x: -30, z: 175, w: 36, d: 24, h: 14, kind: 'academic', color: '#9f714c', interior: false, confidence: 'medium', source: STUDY_MAP },
  { id: 'lagoon-front', label: landmarkLabel('lagoon-front'), zone: 'lagoon', x: 320, z: 0, w: 28, d: 24, h: 1, kind: 'open-space', color: '#4c9b8d', interior: false, confidence: 'high', source: 'Shoreline adjacency; stylised promenade position' },
];

/**
 * Anchors are generated from the same building descriptors as geometry and
 * collision. Interior landmarks put the destination 1.25 metres inside the
 * fully open south front. Exterior landmarks stop 1.25 metres south of it.
 * Open spaces remain unobstructed and use their centre as an approach.
 */
export const ANCHORS: Record<string, CampusAnchor> = Object.fromEntries(BUILDINGS.map((building): [string, CampusAnchor] => {
  const openSpace = building.kind === 'open-space' && !['swimming-pool','amphitheatre'].includes(building.id);
  const z = openSpace
    ? building.z
    : building.z + building.d / 2 + (building.interior ? -1.25 : 1.25);
  return [building.id, {
    id: `${building.id}-anchor`, building: building.id, label: building.label,
    zone: building.zone, x: building.x, y: 0, z, ry: 0,
    kind: building.interior ? 'interior' : 'approach',
    landmark: building.id,
  }];
}));

const studentUnionAnchor = ANCHORS['student-union'];
if (!studentUnionAnchor) throw new TypeError('UNILAG layout has no student-union building');
ANCHORS.people = {...studentUnionAnchor,id:'people',label:landmarkLabel('people')};

/**
 * Broad visual road guides. Walking is allowed throughout campus zones; these
 * routes document the intended portal approaches and are kept clear of solid
 * building footprints.
 */
export const ROADS: CampusRoad[] = [
  { id: 'main-gate-approach', label: 'Main Gate Approach', kind: 'road', width: 4, points: [[-286, -90], [-286, -122], [-200, -122], [-200, -160], [-100, -160]] },
  { id: 'northern-spine', label: 'Northern Spine', kind: 'road', width: 6, points: [[-100, -160], [0, -160], [120, -160], [120, -110], [295, -110], [295, -160], [330, -160]] },
  { id: 'western-spine', label: 'Western Spine', kind: 'road', width: 6, points: [[-200, -80], [-200, 0], [-200, 45], [-215, 45], [-215, 78], [-200, 80]] },
  { id: 'second-gate-approach', label: 'Second Gate Approach', kind: 'road', width: 4, points: [[-282, 232], [-282, 200], [-215, 200], [-215, 150], [-100, 150], [-100, 160]] },
  { id: 'central-spine', label: 'Central Spine', kind: 'road', width: 6, points: [[0, -80], [0, 0], [0, 15], [-20, 15], [-20, 55], [0, 55], [0, 80]] },
  { id: 'eastern-spine', label: 'Eastern Spine', kind: 'road', width: 6, points: [[200, -80], [190, -70], [190, 0], [190, 10], [170, 10], [170, 55], [190, 65], [200, 80]] },
  { id: 'middle-crossing', label: 'Middle Crossing', kind: 'road', width: 6, points: [[-200, 0], [-100, 0], [0, 0], [100, 0], [170, 0], [190, 0], [200, 0], [300, 0], [330, 0]] },
  { id: 'southern-crossing', label: 'Southern Crossing', kind: 'road', width: 6, points: [[-100, 160], [-90, 150], [0, 150], [90, 150], [100, 160], [200, 160], [300, 160], [330, 160]] },
  { id: 'beta-new-hall-link', label: 'Beta Campus Link', kind: 'road', width: 6, points: [[0, -160], [0, -80]], source: 'Synthetic internal beta road; not real-world navigation data' },
  { id: 'beta-main-west-link', label: 'Beta Campus Link', kind: 'road', width: 6, points: [[-200, -122], [-200, -80]], source: 'Synthetic internal beta road; not real-world navigation data' },
  { id: 'beta-new-hall-services', label: 'Beta Campus Link', kind: 'road', width: 6, points: [[0, -80], [0, -90], [90, -90], [120, -110]], source: 'Synthetic internal beta road; not real-world navigation data' },
  { id: 'beta-southwest-link', label: 'Beta Campus Link', kind: 'road', width: 6, points: [[-200, 80], [-215, 95], [-215, 150]], source: 'Synthetic internal beta road; not real-world navigation data' },
  { id: 'beta-southeast-link', label: 'Beta Campus Link', kind: 'road', width: 6, points: [[200, 80], [200, 160]], source: 'Synthetic internal beta road; not real-world navigation data' },
  { id: 'beta-lagoon-link', label: 'Beta Lagoon Link', kind: 'road', width: 6, points: [[330, -160], [330, 0], [330, 160]], source: 'Synthetic internal beta road; not real-world navigation data' },
];

/** The first playable campus position, immediately inside the main gate. */
export const ENTRANCE = Object.freeze({ x: -286, y: 0, z: -112, ry: 0, zone: 'gate' });

/**
 * Complete immutable-by-convention campus data consumed by rendering and walk
 * modules. `raised` is empty because this first campus slice has level floors;
 * future steps or stages must declare their approach before being added here.
 */
export const LAYOUT = Object.freeze({
  orientation: Object.freeze({ x: 'east', z: 'south', north: -Math.PI / 2 }),
  scale: 'stylised-spatial-compression',
  surveyAccurate: false,
  zones: ZONES,
  buildings: BUILDINGS,
  roads: ROADS,
  anchors: ANCHORS,
  entrance: ENTRANCE,
  raised: Object.freeze([]),
});
