/**
 * OWNER: social
 * Place actions: what a regular offers because of where they are, who they are or when it is. Plain data, part of the lazy `dilemmas` chunk
 * (src/game/dilemma-pack.ts), so it is kept out of content/npcs.ts, which the engine always loads. The numbers a life needs without the pack
 * (COUPON_MAX_SAVING, MAX_RELATIONSHIP_TAGS) stay in content/npcs.ts.
 */
import type { PlaceAction } from '../../types/content.ts';

/**
 * Interactions a regular offers because of where they are, who they are or when it is (the kit: src/game/features.ts; which regular
 * offers which is decided in src/game/place-actions.ts). They run exactly like NPC_ACTIONS (the same activity engine, the same four-a-day limit per person)
 * and are listed apart from it so that, with no kit installed, the catalogue is the one it always was. The ids are shared by every city; `label` is English and
 * `pcmLabel` Nigerian Pidgin (every one is `beta`: the Pidgin has not been reviewed by a speaker). Every number is an original beta value.
 *   places        kinds of place that offer it (placeKindOf: scene kinds, with 'worship' split into 'church' and 'mosque')
 *   elder         offered by regulars who are elders
 *   afterService  offered only for a short while after a service ends (SERVICE_TIMES)
 *   grant         what a success also gives: a grocery coupon (percent) and/or something the regular remembers
 */
export const PLACE_ACTIONS: PlaceAction[] = [
  { id: 'haggle', label: 'Haggle', pcmLabel: 'Bargain Price', icon: '🪙', duration: 10, effects: { social: 4, fun: 3 }, bonus: { fun: 4 }, xp: { hustle: 6, charisma: 3 }, points: 3,
    success: { base: 40 }, places: ['market'], grant: { coupon: 10, memory: 'haggled' }, beta: true,
    note: 'The chance uses the joke formula (charisma and closeness). A success also gives a coupon for 10% off the next grocery order today, worth at most ₦300.' },
  { id: 'respect', label: 'Greet with Respect', pcmLabel: 'Greet Am Well', icon: '🙏🏾', duration: 6, effects: { social: 8, fun: 1 }, xp: { charisma: 5 }, points: 4,
    elder: true, grant: { memory: 'respectful' }, beta: true },
  { id: 'queue', label: 'Join the Queue', pcmLabel: 'Join the Line', icon: '🧍🏾', duration: 12, effects: { social: 6, energy: -2 }, xp: { charisma: 4 }, points: 3,
    places: ['hospital', 'office'], grant: { memory: 'patient' }, beta: true },
  { id: 'argue-football', label: 'Argue Football', pcmLabel: 'Argue Ball', icon: '⚽', duration: 10, effects: { social: 5, fun: 8 }, bonus: { fun: 5 }, xp: { comedy: 5, charisma: 3 }, points: 5,
    success: { base: 50 }, places: ['viewing'], grant: { memory: 'ball-talk' }, beta: true },
  { id: 'dryer-gist', label: 'Gist Under the Dryer', pcmLabel: 'Gist Under Dryer', icon: '💇🏾‍♀️', duration: 10, effects: { social: 8, fun: 6 }, xp: { charisma: 6 }, points: 3,
    places: ['salon'], beta: true },
  { id: 'after-service', label: 'Greet After Service', pcmLabel: 'Greet Dem After Service', icon: '🕊️', duration: 8, effects: { social: 10, fun: 2 }, xp: { charisma: 6 }, points: 4,
    places: ['church', 'mosque'], afterService: true, grant: { memory: 'greeted-after-service' }, beta: true,
    note: 'Only offered for a short while after a service has ended.' },
];
