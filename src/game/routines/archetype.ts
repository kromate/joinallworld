// Which routine a regular keeps. The role is free text written by whoever wrote the city ("Cook", "Student", "Morning walker",
// "Ayo player"), so the words of the role are read first and the kind of the venue is the answer when the words say nothing.
// A city can overrule a single regular by id (cities.ts), for the one whose role text points the wrong way.
import type { Archetype } from './types.ts'
import { CITY_ROUTINES } from './cities.ts'

/** Venues that only come alive after dark: whoever is found there keeps a night routine, whatever the role says. */
const NIGHT_KINDS: ReadonlySet<string> = new Set(['club', 'shrine', 'rooftop'])

/** The role words, in the order they are tried. The first row that matches wins, so the narrow rows come before the wide ones. */
const BY_ROLE: readonly (readonly [RegExp, Archetype])[] = [
  [/nurse|nursing|doctor|clinic volunteer|on duty|patient liaison/, 'medic'],
  [/ticket|driver|dispatcher|marshal|commuter|passenger|traveller|check-in|ground staff|travel desk|travel helper|route helper|station attendant|landing helper|porter at|boat/, 'transit'],
  [/student|learner|trainee|apprentice|postgraduate|sketcher|sketching|reader/, 'student'],
  [/(?<!market )\bporter\b|security|gate duty|gate security|at the counter|police|shift engineer|tanker/, 'duty'],
  [/\bcook\b|kitchen|serving|food server|zobo|coconut|food seller|food trader/, 'cook'],
  [/trader|market porter|seller|selling|shopkeeper|wholesaler|craft|phone accessories|produce|yam|pepper/, 'trader'],
  [/stylist|braiding|hair|textile|dyeing|leather|pottery|artisan|workshop|under the dryer/, 'maker'],
  [/lecturer|teacher|mentor|educator|instructor|librarian|technologist|personal trainer|coach/, 'teacher'],
  [/clerk|teller|secretary|officer|administrator|front desk|adviser|official|agent|protocol|registration|ballot|observer|organiser|information volunteer|tea break/, 'clerk'],
  [/supporter|\bfan\b|football|arguing|captain|training partner|ayo player|running the screen/, 'fan'],
  [/walker|jogger|runner|running/, 'walker'],
  [/debugging|pitching|coding|software|media|sound|radio|on air|engineer|music|designer|artist|photograph|lab partner|project/, 'creative'],
  [/guide|attendant|keeper|caretaker|groundsman|host|steward|volunteer|educator|historian|bird watcher|fisher/, 'guide'],
  [/diner|lunch regular|regular customer|food regular|food shopper|food neighbour/, 'diner'],
  [/shopper|customer|client|window shopping|treadmill/, 'shopper'],
  [/visitor|relative|waiting|patient|voter/, 'visitor'],
  [/resident|neighbour|regular|local/, 'resident'],
]

/** What a venue kind says about the people found there, for a role that matches nothing above. */
const BY_KIND: Readonly<Record<string, Archetype>> = {
  office: 'clerk', statehouse: 'clerk', polling: 'clerk', radio: 'creative', police: 'duty', refinery: 'duty', airport: 'transit', hub: 'transit',
  market: 'shopper', buka: 'diner', salon: 'shopper', hospital: 'visitor', unilag: 'student', quad: 'student', gym: 'athlete', mall: 'shopper',
  viewing: 'fan', park: 'resident', walk: 'visitor', beach: 'visitor', hilltop: 'visitor', lakeside: 'visitor', worship: 'worshipper',
}

/** The caretaker and the guide of a house of worship work the building; everyone else there comes for the services. */
const KEEPS_THE_BUILDING = /caretaker|guide|attendant|keeper|educator|teaching/

export function archetypeOf(city: string, id: string, role: string, kind: string): Archetype {
  const chosen = CITY_ROUTINES[city]?.archetypes?.[id]
  if (chosen) return chosen
  const text = role.toLowerCase()
  if (kind === 'worship') return KEEPS_THE_BUILDING.test(text) ? 'keeper' : 'worshipper'
  if (NIGHT_KINDS.has(kind)) return 'nightlife'
  for (const [pattern, archetype] of BY_ROLE) if (pattern.test(text)) return archetype
  return BY_KIND[kind] ?? 'resident'
}
