import type { TrailStopDefinition } from '../../types/campus.ts';
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
