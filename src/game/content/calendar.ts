/**
 * OWNER: growth
 * The events calendar. Plain data only: adding or moving an event is a change to this file and
 * needs no code. All times are Lagos wall-clock time (src/game/clock.ts). Original design.
 *
 * AN EVENT
 *   id       unique id
 *   title    what the player reads;  blurb  one line about it
 *   venue    a venue id from content/venues.ts — where it happens
 *   icon     a glyph name from the icon set
 *   when     ONE of:
 *     { weekday: 0–6, from: hour, to: hour }   every week (0 = Sunday). `to` ≤ `from` runs past midnight
 *     { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', from?: hour, to?: hour }   dated, both days included;
 *                                                with hours, only between them on each of those days
 *   spray    true: guests may "spray" naira here (a pure money sink — see systems/events.ts)
 *   table    optional table-game id this event features
 *
 * An event has no effect on prices, pay or needs: being there counts for missions, and that is
 * all. Nothing here is removed for ever — dated events come back each year with a new row.
 */
import type { CalendarEvent, SprayRules } from '../../types/content.ts'

export const EVENTS_CALENDAR: readonly CalendarEvent[] = Object.freeze([
  { id: 'trivia-night', title: 'Who Sabi? trivia night', blurb: 'Gather at the rooftop and argue about the answers.', venue: 'rooftop', icon: 'star', when: { weekday: 3, from: 20, to: 22 } },
  { id: 'club-night', title: 'Friday club night', blurb: 'Quilox fills up. Buy a shout-out and dance.', venue: 'quilox', icon: 'music', when: { weekday: 5, from: 20, to: 2 } },
  { id: 'owambe', title: 'Saturday owambe', blurb: 'Aso-ebi, jollof and spraying at Freedom Park.', venue: 'park', icon: 'gift', when: { weekday: 6, from: 14, to: 19 }, spray: true },
  { id: 'market-day', title: 'Market day', blurb: 'The market is at its busiest. Go and price things.', venue: 'market', icon: 'groceries', when: { weekday: 6, from: 7, to: 12 } },
  { id: 'match-day', title: 'Big match at the viewing centre', blurb: 'Watch with the crowd, then settle it on penalties.', venue: 'viewing-centre', icon: 'ball', when: { weekday: 0, from: 16, to: 20 }, table: 'penalty' },
  { id: 'whot-evening', title: 'Whot evening at the buka', blurb: 'Tables are open at Amala Shitta. Check up!', venue: 'amala-shitta', icon: 'tables', when: { weekday: 2, from: 18, to: 21 }, table: 'whot' },

  { id: 'felabration-2026', title: 'Felabration', blurb: 'A week of music at the Shrine.', venue: 'shrine', icon: 'music', when: { start: '2026-10-12', end: '2026-10-18', from: 17, to: 23 } },
  { id: 'detty-december-2026', title: 'Detty December', blurb: 'Lagos does not sleep. Beach by day, club by night.', venue: 'beach', icon: 'star', when: { start: '2026-12-18', end: '2026-12-31', from: 12, to: 20 }, spray: true },
  { id: 'new-year-2027', title: 'New Year at the beach', blurb: 'Start the year with your feet in the sand.', venue: 'beach', icon: 'star', when: { start: '2027-01-01', end: '2027-01-01' } },
  { id: 'independence-2027', title: 'Independence Day', blurb: 'Green, white, green at Freedom Park.', venue: 'park', icon: 'governor', when: { start: '2027-10-01', end: '2027-10-01' }, spray: true },
]);

/** Spraying: a sink. Money leaves the wallet for Social and Fun; nobody receives it. */
export const SPRAY: Readonly<SprayRules> = Object.freeze({ amounts: [200, 500, 1000], perDay: 5000, social: 6, fun: 4 });
