/**
 * OWNER: growth
 * Missions: the daily and weekly pools, their rewards, the weekly stamp card and the titles.
 * Plain data only (no functions, no imports). Everything here is an original design.
 *
 * A MISSION
 *   id      unique id
 *   kind    'life' | 'discovery' | 'social' — a day's three missions are one of each kind
 *   label   what the player reads; hint  where to go to do it
 *   count   how many times the trigger must happen (default 1)
 *   on      what counts:
 *     'event'       the registry event `event` (optionally only when data[`where`] is truthy)
 *     'tag'         an activity completes that carries any of `tags`
 *     'paid'        an activity that pays completes (a shift or a gig)
 *     'venue'       arriving somewhere other than home; with `fresh: true` only a venue not yet
 *                   visited this Lagos week counts, and every venue counts once per mission
 *   needs   optional gate, checked when missions are dealt: 'job' (the life has a job)
 *   open / go   what the Go button does: open a panel, or walk to [venue, spot?]
 *
 * NUMBERS (see RESEARCH-GROWTH.md §4.1 and scripts/economy-sim.ts, strategy "social")
 *   A daily mission pays ₦250 and a weekly one ₦1,000, once, when claimed: at most ₦750 a Lagos
 *   day and ₦3,000 a Lagos week. Completing all three of a set adds stars, which are not money.
 */
import type { DayTitle, MissionDefinition, MissionKind, MissionRewards, StampCard } from '../../types/content.ts'

export const MISSION_REWARDS: Readonly<MissionRewards> = Object.freeze({
  daily: { cash: 250, setStars: 2, slots: 3 },
  weekly: { cash: 1000, setStars: 5, slots: 3 },
  /** Free swaps of one unfinished daily mission per Lagos day. */
  rerollsPerDay: 1,
});

/** The weekly card: one stamp per Lagos day with any counted activity. `need` stamps pay `stars` once a week. */
export const STAMP_CARD: Readonly<StampCard> = Object.freeze({ need: 4, stars: 3 });

/** Titles for days lived actively in the city. The count only ever goes up. */
export const DAY_TITLES: readonly DayTitle[] = Object.freeze([
  { id: 'settled', days: 7, label: 'Settled in' },
  { id: 'lagosian', days: 30, label: 'True local' },
  { id: 'city-elder', days: 100, label: 'City elder' },
]);
/** Earned by finishing a whole weekly set; kept for good. */
export const WEEK_TITLE: Readonly<Omit<DayTitle, 'days'>> = Object.freeze({ id: 'week-finisher', label: 'Week finisher' });

export const DAILY_MISSIONS: readonly MissionDefinition[] = Object.freeze([
  { id: 'd-meal', kind: 'life', label: 'Eat a proper meal', hint: 'Cook at home or eat out', on: 'tag', tags: ['food'], go: ['home', 'kitchen'] },
  { id: 'd-shift', kind: 'life', label: 'Finish a shift', hint: 'Go to work and see it through', on: 'event', event: 'shift.completed', needs: 'job', open: 'career' },
  { id: 'd-paid', kind: 'life', label: 'Get paid for something', hint: 'A shift or any paid gig', on: 'paid', open: 'jobs' },
  { id: 'd-fresh', kind: 'life', label: 'Freshen up', hint: 'A bath at home will do', on: 'tag', tags: ['hygiene'], go: ['home', 'bathroom'] },
  { id: 'd-train', kind: 'life', label: 'Practise a skill twice', hint: 'Any training activity counts', on: 'tag', tags: ['training', 'skill'], count: 2, open: 'skills' },
  { id: 'd-fun', kind: 'life', label: 'Do something fun', hint: 'A show, a dance, a game', on: 'tag', tags: ['fun', 'show', 'movie', 'performance'], open: 'map' },

  { id: 'd-two-places', kind: 'discovery', label: 'Go out to two places', hint: 'Open the Map and travel', on: 'venue', count: 2, open: 'map' },
  { id: 'd-new-place', kind: 'discovery', label: 'Visit somewhere new this week', hint: 'A place you have not been to since Monday', on: 'venue', fresh: true, open: 'map' },
  { id: 'd-gem', kind: 'discovery', label: 'Find a gem', hint: 'Follow the gem hunt clues', on: 'event', event: 'gem.found', open: 'hunt-sheet' },
  { id: 'd-wish', kind: 'discovery', label: 'Make a wish come true', hint: 'Your wishes are in Goals', on: 'event', event: 'wish.granted', open: 'goals' },

  { id: 'd-greet', kind: 'social', label: 'Say hello to two people', hint: 'Regulars at any venue count', on: 'event', event: 'npc.greeted', count: 2, open: 'people' },
  { id: 'd-gist', kind: 'social', label: 'Gist with three people', hint: 'Any chat with a regular counts', on: 'tag', tags: ['social'], count: 3, open: 'people' },
  { id: 'd-table', kind: 'social', label: 'Play a table game', hint: 'Whot at the buka, penalties at the viewing centre', on: 'event', event: 'table.played', open: 'tables' },
  { id: 'd-event', kind: 'social', label: 'Show up at an event', hint: 'See what is on in Events', on: 'event', event: 'event.attended', needs: 'event', open: 'events' },
]);

export const WEEKLY_MISSIONS: readonly MissionDefinition[] = Object.freeze([
  { id: 'w-work', kind: 'life', label: 'Get paid on four different days', hint: 'One paid shift or gig a day counts', on: 'event', event: 'work.day', count: 4, open: 'career' },
  { id: 'w-meals', kind: 'life', label: 'Eat ten meals', hint: 'Home cooking counts', on: 'tag', tags: ['food'], count: 10, go: ['home', 'kitchen'] },
  { id: 'w-places', kind: 'discovery', label: 'Visit six different places', hint: 'Each place counts once this week', on: 'venue', fresh: true, count: 6, open: 'map' },
  { id: 'w-gems', kind: 'discovery', label: 'Find nine gems', hint: 'Three days of the gem hunt', on: 'event', event: 'gem.found', count: 9, open: 'hunt-sheet' },
  { id: 'w-tables', kind: 'social', label: 'Play five table games', hint: 'Win or lose, a finished game counts', on: 'event', event: 'table.played', count: 5, open: 'tables' },
  { id: 'w-friend', kind: 'social', label: 'Make a friend', hint: 'Keep talking to someone you like', on: 'event', event: 'friend.made', open: 'people' },
  { id: 'w-greet', kind: 'social', label: 'Say hello to ten people', hint: 'Regulars at any venue count', on: 'event', event: 'npc.greeted', count: 10, open: 'people' },
  { id: 'w-events', kind: 'social', label: 'Show up at two events', hint: 'See what is on in Events', on: 'event', event: 'event.attended', count: 2, open: 'events' },
]);

export const MISSION_KINDS: readonly MissionKind[] = Object.freeze(['life', 'discovery', 'social']);
