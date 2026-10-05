import { BUILDINGS as FOOTPRINTS } from './layout.ts';
import type { CampusBuilding } from './layout.ts';

const STUDY_MAP = 'https://assets-eu.researchsquare.com/files/rs-2926408/v1/fc6eeb08-d1ff-422a-8880-e4baab439b27.pdf?c=1689601461#page=13';
const FIELD_MAP = 'User brief from the UNILAG campus-map interpretation; placement approximate';

type Appearance = Pick<CampusBuilding, 'h' | 'color' | 'confidence' | 'source'>;
const APPEARANCE: Readonly<Record<string, Appearance>> = {
  'main-gate': { h: 8, color: '#8f2434', confidence: 'medium', source: STUDY_MAP },
  'el-kanemi-hall': { h: 13, color: '#c67f4d', confidence: 'medium', source: STUDY_MAP },
  'eni-njoku-hall': { h: 15, color: '#ba6d43', confidence: 'medium', source: STUDY_MAP },
  'sodeinde-hall': { h: 15, color: '#bb7548', confidence: 'medium', source: STUDY_MAP },
  'makama-hall': { h: 15, color: '#bd7c4e', confidence: 'medium', source: STUDY_MAP },
  'fagunwa-hall': { h: 15, color: '#b66b45', confidence: 'medium', source: STUDY_MAP },
  'tinubu-hall': { h: 15, color: '#b97553', confidence: 'medium', source: STUDY_MAP },
  'cafeteria': { h: 7, color: '#d59c50', confidence: 'medium', source: STUDY_MAP },
  'access-bank': { h: 8, color: '#e36b32', confidence: 'medium', source: STUDY_MAP },
  'new-hall-shopping': { h: 8, color: '#b9824d', confidence: 'medium', source: STUDY_MAP },
  'arts': { h: 13, color: '#b56b57', confidence: 'medium', source: STUDY_MAP },
  'law': { h: 14, color: '#9f6658', confidence: 'high', source: 'Mapcarta adjacency: north-west of the library; compressed distance' },
  'management': { h: 15, color: '#ab7655', confidence: 'medium', source: 'Mapcarta N6122566947; compressed placement' },
  'library': { h: 16, color: '#8f6b53', confidence: 'medium', source: 'Mapcarta N6122566943; compressed placement' },
  'senate': { h: 42, color: '#a16e4b', confidence: 'medium', source: STUDY_MAP },
  'auditorium': { h: 14, color: '#ad7957', confidence: 'medium', source: STUDY_MAP },
  'uba-bank': { h: 7, color: '#b5282f', confidence: 'medium', source: STUDY_MAP },
  'environmental': { h: 12, color: '#9d7854', confidence: 'high', source: 'Mapcarta adjacency: north-east of Education; compressed distance' },
  'education-chapel': { h: 11, color: '#8e7b65', confidence: 'high', source: 'Mapcarta adjacency W650873126; compressed distance' },
  'central-mosque': { h: 12, color: '#4f8862', confidence: 'high', source: 'Mapcarta adjacency W1286088886; compressed distance' },
  'henry-carr-hall': { h: 11, color: '#a87955', confidence: 'medium', source: STUDY_MAP },
  'wema-bank': { h: 7, color: '#7550a3', confidence: 'high', source: 'Mapcarta adjacency: north-east of Education; compressed distance' },
  'education': { h: 13, color: '#b98552', confidence: 'medium', source: 'Mapcarta N6122566937; compressed placement' },
  'multipurpose-hall': { h: 12, color: '#8c6b50', confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  'social-sciences': { h: 13, color: '#a67554', confidence: 'medium', source: 'Mapcarta N6122566933; compressed placement' },
  'queen-amina-hall': { h: 14, color: '#b46f51', confidence: 'high', source: 'Mapcarta adjacency: south of Education; compressed distance' },
  'kofo-hall': { h: 13, color: '#bc7952', confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  'biobaku-hall': { h: 13, color: '#ae6748', confidence: 'high', source: 'Mapcarta adjacency: south-east of Education; compressed distance' },
  'sports-centre': { h: 1, color: '#5d9660', confidence: 'medium', source: STUDY_MAP },
  'swimming-pool': { h: 1, color: '#4d91a8', confidence: 'high', source: 'Mapcarta W707208516 adjacency: north of the sports grounds; compressed distance' },
  'amphitheatre': { h: 4, color: '#998267', confidence: 'medium', source: STUDY_MAP },
  'student-union': { h: 11, color: '#b98048', confidence: 'low', source: FIELD_MAP },
  'university-bookshop': { h: 8, color: '#9a7656', confidence: 'low', source: FIELD_MAP },
  'moremi-hall': { h: 14, color: '#bd7451', confidence: 'medium', source: STUDY_MAP },
  'medical-centre': { h: 11, color: '#a67a5e', confidence: 'medium', source: STUDY_MAP },
  'medical-gardens': { h: 1, color: '#5d9764', confidence: 'low', source: FIELD_MAP },
  'jaja-hall': { h: 14, color: '#b76e49', confidence: 'medium', source: STUDY_MAP },
  'engineering': { h: 15, color: '#9c7656', confidence: 'medium', source: STUDY_MAP },
  'mariere-hall': { h: 14, color: '#af694b', confidence: 'medium', source: STUDY_MAP },
  'pharmacy': { h: 13, color: '#a27a5a', confidence: 'medium', source: STUDY_MAP },
  'science': { h: 14, color: '#9f7552', confidence: 'medium', source: STUDY_MAP },
  'honours-hall': { h: 13, color: '#b5724f', confidence: 'medium', source: STUDY_MAP },
  'second-gate': { h: 8, color: '#8f2434', confidence: 'medium', source: STUDY_MAP },
  'dli-building': { h: 14, color: '#9f714c', confidence: 'medium', source: STUDY_MAP },
  'lagoon-front': { h: 1, color: '#4c9b8d', confidence: 'high', source: 'Shoreline adjacency; stylised promenade position' },
};

/** The scene sees the complete building data only after its lazy renderer is requested. */
export const BUILDINGS: CampusBuilding[] = FOOTPRINTS.map(footprint => {
  const appearance = APPEARANCE[footprint.id];
  if (!appearance) throw new TypeError(`Missing campus building appearance: ${footprint.id}`);
  return { ...footprint, ...appearance };
});
