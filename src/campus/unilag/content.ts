import type { ActivityDefinition, NpcDefinition, SpotDefinition, VenueDefinition } from '../../types/content.ts';
import type { TrailStopDefinition } from '../../types/campus.ts';
import type { NeedMap, SkillMap } from '../../types/life.ts';
import { LANDMARKS } from './spot-names.ts';

/**
 * UNILAG content for the campus beta.
 *
 * This module is deliberately data-only. Activity amounts, prices, durations and cooldowns
 * below are original beta values. They describe a playable fictional layer and do not model
 * university admissions, residence allocation, banking or employment policy.
 */

const betaNote = 'Original beta value for the fictional campus layer; not a university policy.';

/** A campus NPC always stands at a spot (`at` is never null here). */
export type CampusNpc = NpcDefinition & { at: string };

const photograph = (id: string, label: string): ActivityDefinition => ({
  id: `photograph-${id}`,
  label: `Photograph ${label}`,
  icon: '📷',
  duration: 4,
  cost: 0,
  effects: { fun: 3 },
  xp: { photography: 3 },
  cooldown: 120,
  tags: ['photography'],
  beta: true,
  note: betaNote,
});

const spot = (id: string, label: string, caption: string, activities: ActivityDefinition[] = []): SpotDefinition => ({
  id,
  label,
  caption,
  activities: id === 'people' ? activities : [photograph(id, label), ...activities],
});

const activity = (id: string, label: string, icon: string, duration: number, cost: number, effects: NeedMap, xp: SkillMap, tags: string[], note = betaNote): ActivityDefinition => ({
  id, label, icon, duration, cost, effects, xp, tags, beta: true, note,
});

const special: Record<string, ActivityDefinition[]> = {
  cafeteria: [activity('eat-2001-cafeteria', 'Eat at 2001 Cafeteria', '🍛', 8, 350, { hunger: 30 }, {}, ['food'])],
  library: [activity('read-library', 'Read and practise coding', '📚', 12, 0, { energy: -3, fun: 5 }, { coding: 8 }, ['study'])],
  'sports-centre': [
    activity('watch-sports', 'Watch the game', '🏟️', 8, 0, { fun: 10 }, {}, ['fun']),
    activity('five-a-side', 'Play five-a-side', '⚽', 14, 0, { fun: 12, energy: -10, hygiene: -5 }, { fitness: 8 }, ['fitness', 'fun']),
  ],
  'lagoon-front': [activity('relax-lagoon', 'Relax at the Lagoon Front', '🌊', 10, 0, { energy: 4, fun: 12 }, {}, ['rest', 'fun'])],
  auditorium: [
    activity('public-lecture', 'Attend a public lecture', '🎓', 14, 0, { fun: 8, social: 5 }, { coding: 2 }, ['learning']),
    activity('auditorium-show', 'Watch a show', '🎭', 12, 250, { fun: 18, social: 4 }, {}, ['show']),
  ],
  'new-hall-shopping': [activity('buy-supplies', 'Buy student supplies', '🛍️', 7, 350, { hunger: 8 }, {}, ['shopping'])],
  'education-chapel': [activity('chapel-worship', 'Worship at the chapel', '⛪', 12, 0, { fun: 8, social: 6 }, {}, ['worship'])],
  'central-mosque': [activity('mosque-worship', 'Worship at the mosque', '🕌', 12, 0, { fun: 8, social: 6 }, {}, ['worship'])],
};

export const spots: Record<string, SpotDefinition> = Object.fromEntries(LANDMARKS.map(([id, label]) => [
  id,
  spot(id, label, `A beta campus landmark at ${label}.`, special[id] ?? []),
]));

// These links describe existing phone surfaces. The bank landmark does not implement deposits.
export const UI_LINKS = Object.freeze({
  bank: Object.freeze({ id: 'bank', label: 'Open Bank in phone', target: 'phone://bank' }),
});

// Student Union table games are intentionally an integration seam for the table-game owner.
const studentUnion = spots['student-union'];
if (!studentUnion) throw new TypeError('UNILAG layout has no student-union anchor');
studentUnion.caption = 'Meet friends, join a club or take a seat at the tables.';
studentUnion.integration = Object.freeze({ requested: 'table-game-framework' });

export const DISCOVERY_TRAIL: ReadonlyArray<TrailStopDefinition> = Object.freeze([
  { id: 'main-gate', label: 'Enter through Main Gate', description: 'Start the Akoka walk.', venue: 'unilag', spot: 'main-gate' },
  { id: 'new-hall', label: 'Find New Hall', description: 'Visit the northern residence zone.', venue: 'unilag', spot: 'cafeteria' },
  { id: 'library', label: 'Study at the Library', description: 'Read and practise coding.', venue: 'unilag', spot: 'library' },
  { id: 'engineering', label: 'Visit Engineering', description: 'See the engineering faculty landmark.', venue: 'unilag', spot: 'engineering' },
  { id: 'sports', label: 'Reach the Sports Centre', description: 'Watch or play on the field.', venue: 'unilag', spot: 'sports-centre' },
  { id: 'auditorium', label: 'Attend the Auditorium', description: 'Find a lecture or show.', venue: 'unilag', spot: 'auditorium' },
  { id: 'lagoon', label: 'Walk to the Lagoon Front', description: 'Relax by the waterfront.', venue: 'unilag', spot: 'lagoon-front' },
  { id: 'student-union', label: 'Find Student Union', description: 'Meet the students by the tables.', venue: 'unilag', spot: 'student-union' },
]);

const baseNpcs: Array<[string, CampusNpc]> = [
  ['aunty-ngozi', { id: 'aunty-ngozi', venue: 'unilag', name: 'Aunty Ngozi', role: 'Food seller at 2001', emoji: '👩🏾', quotes: ['The queue moves when you greet people.', 'Eat first, then face the lecture.'], at: 'cafeteria', beta: true }],
  ['tunde-code', { id: 'tunde-code', venue: 'unilag', name: 'Tunde', role: 'Engineering student', emoji: '🧑🏾‍💻', quotes: ['The bug is somewhere in the cable.', 'Try the smaller loop first.'], at: 'engineering', beta: true }],
  ['bisi-reader', { id: 'bisi-reader', venue: 'unilag', name: 'Bisi', role: 'Library regular', emoji: '👩🏾‍🎓', quotes: ['Quiet please, this chapter is good.', 'The library has the answer somewhere.'], at: 'library', beta: true }],
  ['coach-yemi', { id: 'coach-yemi', venue: 'unilag', name: 'Coach Yemi', role: 'Five-a-side captain', emoji: '🏃🏾', quotes: ['One more pass!', 'Stretch before you sprint.'], at: 'sports-centre', beta: true }],
  ['mariam-lagoon', { id: 'mariam-lagoon', venue: 'unilag', name: 'Mariam', role: 'Lagoon sketcher', emoji: '🎨', quotes: ['The water changes colour every hour.', 'Hold still, the light is perfect.'], at: 'lagoon-front', beta: true }],
  ['seun-stage', { id: 'seun-stage', venue: 'unilag', name: 'Seun', role: 'Student performer', emoji: '🎭', quotes: ['The sound check is nearly done.', 'Save a seat near the front.'], at: 'auditorium', beta: true }],
  ['sister-ade', { id: 'sister-ade', venue: 'unilag', name: 'Sister Ade', role: 'Chapel volunteer', emoji: '⛪', quotes: ['You are welcome here.', 'Take a quiet moment before you go.'], at: 'education-chapel', beta: true }],
  ['kola-union', { id: 'kola-union', venue: 'unilag', name: 'Kola', role: 'Student Union volunteer', emoji: '🧑🏾‍🤝‍🧑🏾', quotes: ['Bring your friends for a game.', 'Ask around and meet somebody new.'], at: 'student-union', beta: true }],
];
export const CAMPUS_NPCS: Record<string, CampusNpc> = Object.fromEntries(baseNpcs);

/** Plain-text share label for the campus discovery card; no HTML is generated. */
export const shareLabel = (trail: TrailStopDefinition | undefined): string => `Share ${trail?.label ?? 'UNILAG discovery'}`;

export const UNILAG_VENUE: VenueDefinition = {
  id: 'unilag',
  cities: ['lagos'],
  label: 'University of Lagos',
  district: 'Akoka, Lagos Mainland',
  icon: '🎓',
  description: 'Walk through Akoka, study, meet friends and explore campus life in Allworld.',
  ambient: ['The shuttle is pulling up by New Hall.', 'A lecturer points the class toward the workshop.', 'You can feel the breeze from the Lagoon Front.'],
  category: 'fun',
  zone: 'mainland',
  map: { x: 56, y: 30 },
  scene: { kind: 'unilag' },
  // No `hours`: the campus is open at any hour (a venue with hours shows "closes at…"; lectures keep their own slots).
  spots,
  beta: true,
  note: 'Map position, activities and effects are original beta values.',
};



const extraNpcs: Array<[string, string, string, string, string[]]> = [
 ['lecturer-ada','Dr Ada','Engineering lecturer','engineering',['Show your workings, not only the answer.','What changes if we remove this resistor?']],
 ['porter-bayo','Mr Bayo','Hall porter','mariere-hall',['Keep the corridor clear, please.','Your reading room is just along the hall.']],
 ['driver-sola','Sola','Shuttle driver','new-hall-shopping',['Next stop, the academic core.','Let everyone get down before you board.']],
 ['security-efe','Efe','Gate security officer','main-gate',['Welcome to Akoka. Stay on the walkway.','The campus map will help you find your way.']],
];
for (const [id,name,role,at,quotes] of extraNpcs) CAMPUS_NPCS[id]={id,venue:'unilag',name,role,at,quotes,emoji:'👤',beta:true};
